defmodule Doorman.Identity do
  @moduledoc "Server-only verified identities and delegation. The application authenticates credentials and authorizes mutations."
  alias Doorman.Storage, as: S

  def validate_options!(opts) do
    secret = Keyword.get(opts, :secret)
    namespace = Keyword.get(opts, :namespace)

    unless is_binary(secret) and byte_size(secret) in 32..4096 and is_binary(namespace) and
             String.trim(namespace) != "" and String.length(namespace) <= 128,
           do: raise(ArgumentError, "identity requires a secret and namespace")
  end

  def label(opts, id),
    do:
      "sub_" <>
        Base.encode16(
          :crypto.mac(
            :hmac,
            :sha256,
            Keyword.fetch!(opts, :secret),
            Jason.encode!(["doorman-subject-v1", Keyword.fetch!(opts, :namespace), id])
          ),
          case: :lower
        )

  def identify_user(c, id), do: update_subject(c, %{id: id, kind: :person})

  def update_subject(c, input) do
    id = required!(input.id, 512)
    kind = input.kind

    unless kind in [:person, :agent, "person", "agent"],
      do: raise(ArgumentError, "invalid subject kind")

    record = %{
      "id" => label(c.identity, id),
      "kind" => to_string(kind),
      "updatedAt" => Doorman.now()
    }

    rows =
      S.query(
        c,
        "INSERT INTO #{S.table(c, "identity_subjects")} AS s (id,kind,record) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record WHERE s.kind = EXCLUDED.kind RETURNING id",
        [record["id"], record["kind"], record]
      )

    if rows == [], do: raise(ArgumentError, "subject kind cannot change")
    record
  end

  def get_subject(c, id), do: get(c, "identity_subjects", "id", reference!(id))

  def delete_subject(c, id),
    do:
      S.query(c, "DELETE FROM #{S.table(c, "identity_subjects")} WHERE id = $1", [reference!(id)])

  defp require_subject!(c, id), do: get_subject(c, id) || raise(ArgumentError, "unknown subject")

  def add_verified_key(c, id, key) do
    require_subject!(c, id)
    key = digest(c, key)

    record = %{
      "digest" => key.digest,
      "subjectId" => id,
      "type" => key.type,
      "issuer" => key.issuer,
      "verifiedAt" => Doorman.now()
    }

    rows =
      S.query(
        c,
        "INSERT INTO #{S.table(c, "identity_keys")} AS k (digest,subject_id,record) VALUES ($1,$2,$3) ON CONFLICT (digest) DO UPDATE SET record = EXCLUDED.record WHERE k.subject_id = EXCLUDED.subject_id RETURNING digest",
        [key.digest, id, record]
      )

    if rows == [], do: raise(ArgumentError, "identity key belongs to another subject")
    :ok
  end

  def find_subject(c, key) do
    case get(c, "identity_keys", "digest", digest(c, key).digest) do
      nil -> nil
      key -> get_subject(c, key["subjectId"])
    end
  end

  def remove_key(c, id, key),
    do:
      S.query(
        c,
        "DELETE FROM #{S.table(c, "identity_keys")} WHERE subject_id = $1 AND digest = $2",
        [reference!(id), digest(c, key).digest]
      )

  defp digest(c, key) do
    type = to_string(key.type)
    issuer = String.trim(required!(key.issuer, 256))
    value = String.trim(required!(key.value, 512))
    unless type in ~w(email external public-key), do: raise(ArgumentError, "invalid key type")

    value =
      if type == "email" do
        unless byte_size(value) <= 254 and Regex.match?(~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/, value),
          do: raise(ArgumentError, "invalid email")

        [local, domain] = String.split(value, "@")
        local <> "@" <> String.downcase(domain)
      else
        value
      end

    %{
      type: type,
      issuer: issuer,
      digest: label(c.identity, Jason.encode!(["identity-key-v1", type, issuer, value]))
    }
  end

  def create_delegation(c, input) do
    require_subject!(c, input.principal_id)
    require_subject!(c, input.actor_id)

    if input.principal_id == input.actor_id,
      do: raise(ArgumentError, "delegation requires distinct actors")

    expires = input.expires_at

    unless is_integer(expires) and expires > Doorman.now() and
             expires <= Doorman.now() + 30 * 86_400_000,
           do: raise(ArgumentError, "delegation must expire within 30 days")

    scopes = scopes!(input.scopes, 1)

    record = %{
      "id" => Doorman.random_id("dlg_"),
      "principalId" => input.principal_id,
      "actorId" => input.actor_id,
      "audience" => String.trim(required!(input.audience, 256)),
      "scopes" => scopes,
      "expiresAt" => expires
    }

    S.query(
      c,
      "INSERT INTO #{S.table(c, "identity_delegations")} (id,principal_id,actor_id,expires_at,record) VALUES ($1,$2,$3,$4,$5)",
      [record["id"], input.principal_id, input.actor_id, expires, record]
    )

    record
  end

  def revoke_delegation(c, id),
    do:
      S.query(
        c,
        "UPDATE #{S.table(c, "identity_delegations")} SET record = jsonb_set(record,'{revokedAt}',to_jsonb($1::bigint)) WHERE id = $2",
        [Doorman.now(), grant!(id)]
      )

  def assess(c, context \\ nil) do
    unknown = %{
      "subject" => %{"status" => "unknown"},
      "actor" => %{"kind" => "unknown", "basis" => "unknown"},
      "delegation" => %{"status" => "none"}
    }

    if is_nil(context), do: unknown, else: assess_context(c, context, unknown)
  end

  defp assess_context(c, context, result) do
    subject = get_subject(c, context.subject_id)
    actor = if context[:actor_id], do: get_subject(c, context.actor_id)

    result =
      if subject,
        do: Map.put(result, "subject", %{"id" => subject["id"], "status" => "verified"}),
        else: result

    result =
      if actor,
        do:
          Map.put(result, "actor", %{
            "id" => actor["id"],
            "kind" => actor["kind"],
            "basis" => "verified-credential"
          }),
        else: result

    if context[:delegation_id] do
      grant = get(c, "identity_delegations", "id", grant!(context.delegation_id))
      required = scopes!(context[:required_scopes] || [], 0)

      reason =
        cond do
          is_nil(grant) -> "missing"
          Map.has_key?(grant, "revokedAt") -> "revoked"
          grant["expiresAt"] <= Doorman.now() -> "expired"
          is_nil(subject) or grant["principalId"] != subject["id"] -> "principal"
          is_nil(actor) or grant["actorId"] != actor["id"] -> "actor"
          is_nil(context[:audience]) or grant["audience"] != context.audience -> "audience"
          Enum.any?(required, &(&1 not in grant["scopes"])) -> "scope"
          true -> nil
        end

      delegation =
        if reason,
          do: %{"id" => context.delegation_id, "status" => "invalid", "reason" => reason},
          else: %{
            "id" => grant["id"],
            "status" => "valid",
            "scopes" => grant["scopes"],
            "expiresAt" => grant["expiresAt"]
          }

      Map.put(result, "delegation", delegation)
    else
      result
    end
  end

  def cleanup(c),
    do:
      S.query(c, "DELETE FROM #{S.table(c, "identity_delegations")} WHERE expires_at <= $1", [
        Doorman.now()
      ])

  defp get(c, table, field, id) do
    case S.query(c, "SELECT record FROM #{S.table(c, table)} WHERE #{field} = $1", [id]) do
      [row] -> row["record"]
      [] -> nil
    end
  end

  defp required!(value, max) do
    unless is_binary(value) and String.trim(value) != "" and String.length(value) <= max,
      do: raise(ArgumentError, "invalid identity value")

    value
  end

  defp reference!(id), do: validate_id!(id, ~r/^sub_[a-f0-9]{64}$/)
  defp grant!(id), do: validate_id!(id, ~r/^dlg_[a-f0-9]{48}$/)

  defp validate_id!(id, regex) do
    unless is_binary(id) and Regex.match?(regex, id),
      do: raise(ArgumentError, "invalid identity reference")

    id
  end

  defp scopes!(values, min) do
    unless is_list(values) and length(values) >= min and length(values) <= 32,
      do: raise(ArgumentError, "invalid scopes")

    values |> Enum.map(&String.trim(required!(&1, 256))) |> Enum.uniq() |> Enum.sort()
  end
end

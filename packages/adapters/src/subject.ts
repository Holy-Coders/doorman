export type SubjectLinkingOptions = { secret: string; namespace: string };

// Derive an application-scoped opaque label from an already authenticated account.
// This is not authentication, fingerprint inference, or an anonymous-account lookup.
export function createSubjectLinker(options: SubjectLinkingOptions) {
  if (options.secret.length < 32 || options.secret.length > 4096)
    throw new Error(
      "Subject linking requires a secret of at least 32 characters",
    );
  if (!options.namespace.trim() || options.namespace.length > 128)
    throw new Error("Subject linking requires an application namespace");
  let key: Promise<CryptoKey> | undefined;
  return async (authenticatedSubject: string) => {
    key ??= crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(options.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const message = JSON.stringify([
      "janitor-subject-v1",
      options.namespace,
      authenticatedSubject,
    ]);
    const signature = await crypto.subtle.sign(
      "HMAC",
      await key,
      new TextEncoder().encode(message),
    );
    return (
      "sub_" +
      Array.from(new Uint8Array(signature), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
    );
  };
}

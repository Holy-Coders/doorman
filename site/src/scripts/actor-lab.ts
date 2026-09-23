import { assessIdentity } from "@aarondovturkel/doorman-core";
import type {
  Delegation,
  IdentityStorage,
  IdentitySubject,
  VerifiedIdentityContext,
} from "@aarondovturkel/doorman-core";

const people: IdentitySubject[] = [
  { id: "sub_" + "a".repeat(64), kind: "person", updatedAt: 0 },
  { id: "sub_" + "b".repeat(64), kind: "agent", updatedAt: 0 },
  { id: "sub_" + "c".repeat(64), kind: "person", updatedAt: 0 },
];
const copy: Record<string, string> = {
  human:
    "The same verified principal owns the account and acts in this session. No delegation is supplied. A person credential still does not prove live human operation.",
  agent:
    "A separately authenticated agent has a current grant for calendar:read. Automation and authorization answer different questions.",
  family:
    "A separately authenticated family member has a limited grant on the shared account. The account stays the same; the actor is distinct.",
  revoked:
    "The agent credential still identifies the actor, but the owner revoked this grant. Doorman reports the invalid delegation; your app decides what to do.",
  scope:
    "The agent has calendar:read, but this action needs calendar:write. Familiar identity does not expand permission.",
  expired:
    "The grant's expiry has passed. The agent is still recognizable; its old delegation is no longer valid.",
  unknown:
    "The account context is verified, but there is no separately verified actor. Doorman leaves the actor unknown instead of guessing human, agent, or intruder.",
};
const readOnly = async () => {
  throw new Error("The actor lab is read-only");
};

document.querySelectorAll<HTMLElement>("[data-actor-lab]").forEach((lab) => {
  const buttons = [
    ...lab.querySelectorAll<HTMLButtonElement>("[data-actor-scenario]"),
  ];
  const set = (selector: string, value: string) => {
    const element = lab.querySelector(selector);
    if (element) element.textContent = value;
  };
  async function run(scenario: string) {
    buttons.forEach((button) => {
      button.disabled = true;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.actorScenario === scenario),
      );
    });
    const now = Date.now();
    const owner = people[0]!;
    const actor =
      people[scenario === "family" ? 2 : scenario === "human" ? 0 : 1]!;
    const delegated = !["human", "unknown"].includes(scenario);
    const grant: Delegation = {
      id: "dlg_" + "d".repeat(48),
      principalId: owner.id,
      actorId: actor.id,
      audience: "calendar-api",
      scopes: ["calendar:read"],
      expiresAt: now + (scenario === "expired" ? -1000 : 3600000),
      ...(scenario === "revoked" ? { revokedAt: now - 1000 } : {}),
    };
    const context: VerifiedIdentityContext = {
      subjectId: owner.id,
      ...(scenario === "unknown" ? {} : { actorId: actor.id }),
      ...(delegated
        ? {
            delegationId: grant.id,
            audience: "calendar-api",
            requiredScopes: [
              scenario === "scope" ? "calendar:write" : "calendar:read",
            ],
          }
        : {}),
    };
    const storage: IdentityStorage = {
      getSubject: async (id) => people.find((person) => person.id === id),
      getDelegation: async (id) => (id === grant.id ? grant : undefined),
      getKey: async () => undefined,
      putSubject: readOnly,
      deleteSubject: readOnly,
      putKey: readOnly,
      deleteKey: readOnly,
      putDelegation: readOnly,
      revokeDelegation: readOnly,
      cleanupIdentity: readOnly,
    };
    try {
      const result = await assessIdentity(storage, context, now);
      const invalid = result.delegation.status === "invalid";
      lab.dataset.verdict = invalid
        ? "invalid"
        : scenario === "unknown"
          ? "unknown"
          : "valid";
      set(
        "[data-actor-verdict]",
        invalid
          ? "Invalid grant"
          : delegated
            ? "Valid delegation"
            : scenario === "unknown"
              ? "Actor unknown"
              : "Same principal",
      );
      set(
        "[data-actor-name]",
        scenario === "unknown"
          ? "unknown"
          : scenario === "human"
            ? "account_owner"
            : scenario === "family"
              ? "family_member"
              : "assistant_agent",
      );
      set(
        "[data-actor-glyph]",
        result.actor.kind === "agent"
          ? ">_"
          : result.actor.kind === "unknown"
            ? "?"
            : scenario === "family"
              ? "⊕"
              : "◎",
      );
      set("[data-grant-glyph]", invalid ? "×" : delegated ? "✓" : "—");
      set(
        "[data-grant-state]",
        result.delegation.reason ??
          (delegated ? "scoped + active" : "none supplied"),
      );
      set("[data-account-evidence]", result.subject.status);
      set("[data-actor-kind]", result.actor.kind);
      set("[data-actor-scope]", context.requiredScopes?.[0] ?? "not assessed");
      set("[data-actor-explanation]", copy[scenario] ?? "");
      set("[data-actor-json]", JSON.stringify(result, null, 2));
      if (
        !matchMedia("(prefers-reduced-motion: reduce)").matches &&
        document.body.dataset.motion !== "paused"
      ) {
        lab
          .querySelectorAll<HTMLElement>(
            ".actor-current .actor-node, .actor-authority .actor-node",
          )
          .forEach((node, i) => {
            node.getAnimations().forEach((animation) => animation.cancel());
            node.animate(
              [
                { transform: "scale(.86)", opacity: 0.4 },
                { transform: "scale(1)", opacity: 1 },
              ],
              {
                duration: 380,
                delay: i * 70,
                easing: "cubic-bezier(.2,.8,.2,1)",
              },
            );
          });
        const diagram = lab.querySelector(".actor-diagram");
        diagram?.classList.remove("actor-transfer");
        requestAnimationFrame(() =>
          requestAnimationFrame(() => diagram?.classList.add("actor-transfer")),
        );
      }
    } catch {
      set(
        "[data-actor-explanation]",
        "The local scenario could not run. Choose a scenario to try again.",
      );
      set("[data-actor-verdict]", "Unavailable");
    } finally {
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }
  buttons.forEach((button) =>
    button.addEventListener("click", () => {
      void run(button.dataset.actorScenario ?? "human");
    }),
  );
  void run("human");
});

# Doorman website design

Doorman is a developer library for first-party browser identity, verified people and agents, private risk estimates and analytics context. The design must explain those distinctions to a new reader.

## Direction from the supplied references

Use the bold typography and candy colours of the cream fitness-app reference, with a black particle stage inspired by the forming point-cloud reference. The animation tells a specific Doorman story: different illustrated operators approach the same door. It is a visual explanation, not a live detector or evidence of classifier accuracy.

Palette: cream `#fff5e3`, ink `#171510`, lime `#d9f35c`, pink `#f5aacb`, amber `#ffae42`, lavender `#baaff2`. Dark mode uses the same accents with readable cream text. Space Grotesk at a strong display weight carries the headline and wordmark; ordinary sans-serif text and code styles stay readable in the docs.

Layout: a large left-aligned headline and short introduction above a wide black stage. The actor selector sits along its top edge. Dots begin scattered, assemble into a human, another human, robot or assistant, then enter an outlined door. Quiet explanatory content and real integration code follow; lower sections use selective blocks of colour rather than making every section a card.

```
doorman                        docs / playground / GitHub      theme
Know who is behind             concise explanation
 the request.                  install / documentation
+ actor selector ----------------------------------------------+
| black canvas: scattered pixels -> illustrated actor -> door   |
| same account                                      pause      |
+--------------------------------------------------------------+
verified identities / private estimates / your existing analytics
code and setup / limitations / documentation
```

## Review before implementation

The memorable element is the actor-at-the-door canvas, grounded in the product name. Cream and lime are explicit reference choices, not a generic palette. Avoid security shields, a gate that rejects visitors, or fake confidence numbers. Keep the selector usable with keyboard navigation and in reduced-motion mode. Disable unnecessary rendering while hidden or offscreen; a static SVG scene explains the same story without JavaScript. All motion is local and sends no telemetry.

The image-generation logo uses an open doorway inside a lowercase d and three coloured pixel tiles. Keep its silhouette crisp and preserve a legible light/dark treatment. Documentation retains a global language picker shown only on docs pages.

import { Identify } from "./identify";
export default function Page() {
  return (
    <main>
      <h1>First-party visitor identity</h1>
      <p>
        This example summarizes interaction counts, motion and timing while open
        and sends those totals with browser properties when you select Identify.
        It does not capture keys, absolute coordinates, or form contents.
        Clearing the cookie may still allow recognition from stored
        observations.
      </p>
      <Identify />
    </main>
  );
}

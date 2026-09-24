"use client";
import { useEffect, useRef, useState } from "react";
import { createDoormanClient } from "@aarondovturkel/doorman-browser";
export function Identify() {
  const client = useRef<ReturnType<typeof createDoormanClient> | null>(null);
  const [result, setResult] = useState("No observation sent yet.");
  useEffect(() => {
    const visitor = createDoormanClient({
      endpoint: "/api/visitor",
      collection: "extended",
    });
    client.current = visitor;
    return () => {
      visitor.destroy();
      client.current = null;
    };
  }, []);
  async function identify() {
    try {
      setResult(JSON.stringify(await client.current?.identify(), null, 2));
    } catch (error) {
      setResult(
        error instanceof Error ? error.message : "Identification failed",
      );
    }
  }
  return (
    <>
      <button type="button" onClick={identify}>
        Identify this browser
      </button>
      <pre aria-live="polite">{result}</pre>
    </>
  );
}

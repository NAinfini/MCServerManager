import { useEffect, useRef } from "react";

interface UnsavedGuardOptions {
  isDirty: boolean;
  message?: string;
  onDiscard?: () => void;
}

const defaultMessage = "You have unsaved changes. Leave without saving?";

/**
 * Warns before a browser/window close and guards hash-based application
 * navigation while a form contains unsaved edits. The hash guard intentionally
 * stays local to the form so individual routes do not need router coupling.
 */
export function useUnsavedGuard({
  isDirty,
  message = defaultMessage,
  onDiscard,
}: UnsavedGuardOptions) {
  const isDirtyRef = useRef(isDirty);
  const messageRef = useRef(message);
  const onDiscardRef = useRef(onDiscard);
  const lastHashRef = useRef(
    typeof window === "undefined" ? "" : window.location.hash,
  );
  const restoringRef = useRef(false);

  isDirtyRef.current = isDirty;
  messageRef.current = message;
  onDiscardRef.current = onDiscard;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    const handleHashChange = () => {
      const nextHash = window.location.hash;
      if (restoringRef.current) {
        restoringRef.current = false;
        return;
      }
      if (!isDirtyRef.current) {
        lastHashRef.current = nextHash;
        return;
      }
      if (window.confirm(messageRef.current)) {
        lastHashRef.current = nextHash;
        onDiscardRef.current?.();
        return;
      }
      restoringRef.current = true;
      window.location.hash = lastHashRef.current;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);
}

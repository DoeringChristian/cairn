import { useEffect, useState } from "react";

export function useModifierKey() {
  const [down, setDown] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.key === "Control" || e.key === "Meta")
        setDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.key === "Control" || e.key === "Meta")
        setDown(false);
    };
    const onBlur = () => setDown(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return down;
}

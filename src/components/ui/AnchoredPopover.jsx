import React, {useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";

/** A viewport-bounded overlay; the anchor may live inside an overflow container. */
export default function AnchoredPopover({anchorRef, onClose, children, className, label}) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({visibility: "hidden"});
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = anchorRef.current?.querySelector("button") || anchorRef.current;
    if (!menu || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft || 0) + 8;
      const top = (viewport?.offsetTop || 0) + 8;
      const right = left + (viewport?.width || window.innerWidth) - 16;
      const bottom = top + (viewport?.height || window.innerHeight) - 16;
      // Browser zoom already changes CSS viewport units. Account separately for
      // a root CSS zoom (used by embedded hosts and our layout fixture).
      const scale = Number(getComputedStyle(document.documentElement).zoom) || 1;
      const width = Math.min(240, Math.max(1, right - left) / scale);
      const naturalHeight = (menu.scrollHeight + 2) * scale;
      const below = Math.max(0, bottom - rect.bottom - 8);
      const above = Math.max(0, rect.top - top - 8);
      const useBelow = naturalHeight <= below || below >= above;
      const available = Math.max(1, Math.min(bottom - top, useBelow ? below : above));
      const height = Math.min(naturalHeight, available);
      const y = Math.max(top, Math.min(bottom - height, useBelow ? rect.bottom + 8 : rect.top - 8 - height));
      const x = Math.max(left, Math.min(rect.left, right - width * scale));
      const next = {visibility: "visible", left: x / scale, top: y / scale, width,
        maxHeight: available / scale};
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const keydown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); anchor.focus(); }
    };
    const outside = (event) => {
      if (!menu.contains(event.target) && !anchorRef.current?.contains(event.target)) onClose();
    };
    const observer = new ResizeObserver(place);
    observer.observe(menu); observer.observe(anchor);
    place();
    document.addEventListener("keydown", keydown);
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [anchorRef, onClose]);
  return createPortal(<div ref={menuRef} role="dialog" aria-label={label}
    data-attachment-menu className={className}
    style={{...position, position: "fixed", zIndex: 1000, overflowY: "auto", overscrollBehavior: "contain"}}>
    {children}
  </div>, document.body);
}

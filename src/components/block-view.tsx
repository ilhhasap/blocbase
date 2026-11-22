import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LIVE } from "@/components/live";
import { VIEWS } from "@/components/kits";
import { BLOCKS } from "@/data/blocks";
import { kitIn, ShadowHost } from "@/components/shadow-host";
import { generatedView, isGenerated } from "@/lib/generated";

/**
 * Fits a block into its card. A block wider than the room it has (or narrower than the width it is
 * laid out for, `minW`) is drawn at that width and scaled down, so nothing is clipped or overlaps.
 * Copy to Figma lifts the scale first (see `copyBlock`), so the copied frame keeps its real size.
 */
function Fit({ minW, noShadow, children }: { minW?: number; noShadow?: boolean; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, width: 0, height: 0 });
  // The block lives in a shadow root created after the first render; measure again once it is there.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const outerEl = outer.current;
    const innerEl = inner.current;
    if (!outerEl || !innerEl) return;
    const measure = () => {
      const kit = kitIn(innerEl);
      const avail = outerEl.clientWidth;
      // `offsetWidth` ignores the transform, so this is the block's real width.
      const natural = Math.max(minW ?? 0, kit?.offsetWidth ?? 0);
      let scale = avail > 0 && natural > avail + 1 ? avail / natural : 1;
      // In the equal-tile grid a card has a fixed height too, so a tall block is scaled down to fit it.
      const stage = outerEl.closest<HTMLElement>('[data-layout="grid"] .stage');
      if (stage && natural > 0 && innerEl.offsetHeight > 0) {
        const style = getComputedStyle(stage);
        const room = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        if (room > 0 && innerEl.offsetHeight > room) scale = Math.min(scale, room / innerEl.offsetHeight);
      }
      const height = scale < 1 ? Math.round(innerEl.offsetHeight * scale) : 0;
      const width = scale < 1 ? natural : 0;
      setFit((prev) => (prev.scale === scale && prev.width === width && prev.height === height ? prev : { scale, width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outerEl);
    observer.observe(innerEl);
    const kit = kitIn(innerEl);
    if (kit) observer.observe(kit);
    return () => observer.disconnect();
  }, [minW, ready]);

  const scaled = fit.scale < 1;
  return (
    <div
      ref={outer}
      data-fit=""
      style={{ width: "100%", height: scaled ? fit.height : undefined, display: scaled ? "flex" : undefined, justifyContent: "center" }}
    >
      {/* Centres a block that is scaled down more than its width needs (the equal-tile grid). */}
      <div style={{ width: scaled ? Math.round(fit.width * fit.scale) : "100%", height: scaled ? fit.height : undefined, flex: "none" }}>
        <div
          ref={inner}
          data-fit-inner=""
          style={{
            display: "flex",
            justifyContent: "center",
            width: scaled ? fit.width : "100%",
            transform: scaled ? `scale(${fit.scale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          <ShadowHost noShadow={noShadow} onReady={() => setReady(true)}>
            {children}
          </ShadowHost>
        </div>
      </div>
    </div>
  );
}

/** Interactive version of a block when one exists, otherwise the static one. */
export function BlockView({ id }: { id: string }) {
  const View = LIVE[id] ?? VIEWS[id] ?? generatedView(id);
  if (!View) return null;
  const block = BLOCKS.find((item) => item.id === id);
  // Only cards carry a shadow; on every other block it is removed, on the page and in the copy.
  return (
    <Fit minW={block?.minW} noShadow={!isGenerated(id) && block?.cat !== "Card"}>
      <View />
    </Fit>
  );
}

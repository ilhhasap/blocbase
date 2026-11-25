import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { BLOCKS, groupOf, resolveBlockId } from "@/data/blocks";

export const Route = createFileRoute("/_site/b/$id")({
  beforeLoad: ({ params }) => {
    const id = resolveBlockId(params.id);
    if (!id) throw notFound();
    // An old id (an alias) goes to the block's current address.
    if (id !== params.id) throw redirect({ to: "/b/$id", params: { id }, replace: true });
  },
  head: ({ params }) => {
    const block = BLOCKS.find((item) => item.id === params.id);
    if (!block) return {};
    const kind = groupOf(block.cat) === "Sections" ? "section" : "component";
    const title = `${block.name} — Blocbase`;
    const description = `${block.name}: a free ${block.cat.toLowerCase()} ${kind} for Figma. Tune it, copy it and paste it as auto layout.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
});

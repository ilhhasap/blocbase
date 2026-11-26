import { createFileRoute, notFound } from "@tanstack/react-router";

/** `/` is the component library; `/sections`, `/pricing`, `/mimic` and `/saved` are the other pages. */
const PAGES = ["sections", "pricing", "mimic", "saved"];

const TITLES: Record<string, { title: string; description: string }> = {
  sections: {
    title: "Sections — Blocbase",
    description: "Hero, features, call to action, FAQ and footer sections. Copy one and paste it into Figma as auto layout.",
  },
  mimic: {
    title: "Remake — Blocbase",
    description: "Upload a screenshot of a component and get it back as an editable block you can paste into Figma. Coming soon.",
  },
  saved: {
    title: "Saved — Blocbase",
    description: "The blocks you saved.",
  },
  pricing: {
    title: "Pricing — Blocbase",
    description: "Blocbase is free. The first three blocks need no account; after that, log in with a free account to keep copying.",
  },
};

export const Route = createFileRoute("/_site/{-$page}")({
  beforeLoad: ({ params }) => {
    if (params.page && !PAGES.includes(params.page)) throw notFound();
  },
  head: ({ params }) => {
    const page = params.page ? TITLES[params.page] : undefined;
    if (!page) return {};
    return {
      meta: [
        { title: page.title },
        { name: "description", content: page.description },
        { property: "og:title", content: page.title },
        { property: "og:description", content: page.description },
        ...(params.page === "saved" ? [{ name: "robots", content: "noindex" }] : []),
      ],
    };
  },
});

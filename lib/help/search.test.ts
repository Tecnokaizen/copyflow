import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchHelpArticles } from "@/lib/help/search";

describe("help search ranking", () => {
  const articles = [
    {
      slug: "equipo/responsables",
      title: "Responsables",
      description: "Asignar o cambiar quién lleva un pedido.",
      keywords: ["reasignar", "reasignar pedido", "cambiar responsable"],
      text: "responsables reasignar pedido cambiar responsable personal",
    },
    {
      slug: "guias/reasignar",
      title: "Cómo reasignar un pedido",
      description: "Cambiar el responsable de un trabajo.",
      keywords: ["reasignar", "cambiar responsable"],
      text: "cómo reasignar un pedido cambia el responsable",
    },
    {
      slug: "pedidos",
      title: "Pedidos",
      description: "Lista de pedidos",
      keywords: [],
      text: "lista de pedidos filtrar buscar",
    },
  ];

  it("ranks keyword and title intention above weak body matches", () => {
    const hits = searchHelpArticles(articles, "reasignar pedido");
    assert.ok(hits.length >= 2);
    assert.ok(hits[0].slug.includes("reasignar") || hits[0].slug.includes("responsables"));
    assert.equal(hits.some((hit) => hit.slug === "pedidos"), false);
  });

  it("returns empty for short queries", () => {
    assert.deepEqual(searchHelpArticles(articles, "a"), []);
  });
});

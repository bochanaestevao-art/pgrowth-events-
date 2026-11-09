import lookupHandler from "../lib/checkin-lookup.js";
import searchHandler from "../lib/checkin-search.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const mode = String(req.query?.mode || "")
    .trim()
    .toLowerCase();

  if (mode === "lookup") {
    return lookupHandler(req, res);
  }

  if (mode === "search") {
    return searchHandler(req, res);
  }

  return res.status(400).json({
    success: false,
    message: "Operação de Check-in não especificada."
  });
}

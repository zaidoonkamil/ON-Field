const BAGHDAD_NAME = "بغداد";

function normalizeGovernorateName(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

module.exports = {
  BAGHDAD_NAME,
  normalizeGovernorateName,
};

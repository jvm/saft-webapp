// Loads XSD from public folder (kept for API compatibility, but not used)
export async function fetchXsdSchema() {
  const response = await fetch('/SAFTPT1.04_01.xsd');
  if (!response.ok) throw new Error('Failed to load XSD schema');
  return await response.text();
}

// Checks if XML is well-formed using DOMParser
export async function validateXmlWithXsd(xmlText, xsdText) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    const parseError = xmlDoc.getElementsByTagName('parsererror');
    if (parseError.length > 0) {
      return { errors: [parseError[0].textContent] };
    }
    return { errors: [] };
  } catch (e) {
    return { errors: [e.message] };
  }
}

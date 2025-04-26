// Sequentiality check for SAF-T document numbers
// This example checks SalesInvoices > Invoice > InvoiceNo, but can be extended for other doc types

export function checkSequentiality(xmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
  // Only check InvoiceNo under SourceDocuments > SalesInvoices > Invoice
  const invoices = Array.from(
    xmlDoc.getElementsByTagName('Invoice')
  ).filter(inv => {
    let parent = inv.parentElement;
    return parent && parent.nodeName === 'SalesInvoices' &&
      parent.parentElement && parent.parentElement.nodeName === 'SourceDocuments';
  });
  const numbers = [];
  // Track sequence per prefix
  let lastPrefix = null;
  let lastNumber = null;
  for (let i = 0; i < invoices.length; i++) {
    const invoiceNoNode = invoices[i].getElementsByTagName('InvoiceNo')[0];
    if (invoiceNoNode && invoiceNoNode.textContent) {
      // Extract prefix and number (e.g., FT 2024/1 -> prefix: FT 2024, number: 1)
      const match = invoiceNoNode.textContent.match(/^(.*)\/(\d+)$/);
      if (match) {
        const prefix = match[1];
        const number = parseInt(match[2], 10);
        if (lastPrefix === prefix) {
          // Sequence must increment by 1
          if (lastNumber !== null && number !== lastNumber + 1) {
            return {
              ok: false,
              message: `Non-sequential InvoiceNo in prefix series '${prefix}': ${lastNumber} followed by ${number}`,
              actual: number,
              expected: lastNumber + 1,
            };
          }
        }
        // If prefix changed, restart sequence (no check)
        lastPrefix = prefix;
        lastNumber = number;
      }
    }
  }
  return { ok: true };

  return { ok: true };
}

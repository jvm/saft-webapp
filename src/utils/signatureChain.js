// SAF-T PT Signature Chain Validation Utility
// Validates the digital signature chain for Invoices in a SAF-T XML file.
// Uses the browser's SubtleCrypto API for RSA signature verification.

// Helper: Convert PEM public key to CryptoKey
async function importRsaPublicKey(pem, hashAlgorithm) {
  // Remove PEM header/footer and newlines
  const pemHeader = "-----BEGIN PUBLIC KEY-----";
  const pemFooter = "-----END PUBLIC KEY-----";
  let pemContents = pem.replace(pemHeader, '').replace(pemFooter, '').replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  return await window.crypto.subtle.importKey(
    'spki',
    binaryDer.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: hashAlgorithm },
    },
    false,
    ['verify']
  );
}

// Helper: Base64 decode
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Main signature chain validation
export async function validateSignatureChain(xmlText, publicKeyPem, hashAlgorithm = 'SHA-1') {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
  
  // Namespace helper
  function getNs(node, tag) {
    return node.getElementsByTagNameNS('urn:OECD:StandardAuditFile-Tax:PT_1.04_01', tag)[0];
  }

  // Get all Invoice nodes in order
  const invoices = Array.from(xmlDoc.getElementsByTagNameNS('urn:OECD:StandardAuditFile-Tax:PT_1.04_01', 'Invoice'));
  if (invoices.length === 0) {
    return { status: 'NOK', processed: 0, seriesCount: 0, validCount: 0, sequenceFails: 0, signatureFails: 0, failedDocs: [], message: 'No Invoice nodes found.' };
  }

  // Import public key
  let cryptoKey;
  try {
    cryptoKey = await importRsaPublicKey(publicKeyPem, hashAlgorithm);
  } catch (e) {
    return { status: 'NOK', processed: 0, seriesCount: 0, validCount: 0, sequenceFails: 0, signatureFails: 0, failedDocs: [], message: 'Failed to import public key: ' + e.message };
  }

  let prevHashByPrefix = {};
  let lastNumberByPrefix = {};
  let seriesSet = new Set();
  let processed = 0;
  let validCount = 0;
  let sequenceFails = 0;
  let signatureFails = 0;
  let failedDocs = [];

  for (let i = 0; i < invoices.length; i++) {
    processed++;
    const inv = invoices[i];
    const invoiceNoNode = getNs(inv, 'InvoiceNo');
    const invoiceNo = invoiceNoNode?.textContent || '';
    const prefixMatch = invoiceNo.match(/^(.*)\/(\d+)$/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    const number = prefixMatch ? parseInt(prefixMatch[2], 10) : null;
    seriesSet.add(prefix);
    const invoiceDate = getNs(inv, 'InvoiceDate')?.textContent || '';
    const systemEntryDate = getNs(inv, 'SystemEntryDate')?.textContent || '';
    const grossTotal = getNs(inv, 'GrossTotal')?.textContent || '';
    const hashNode = getNs(inv, 'Hash');
    if (!hashNode) {
      failedDocs.push({ row: i + 1, InvoiceNo: invoiceNo, type: 'hash', message: 'Missing <Hash>' });
      continue;
    }
    const hashValue = hashNode.textContent;

    // Sequentiality check
    let seqFail = false;
    if (lastNumberByPrefix[prefix] !== undefined && number !== null) {
      if (number !== lastNumberByPrefix[prefix] + 1) {
        sequenceFails++;
        seqFail = true;
        failedDocs.push({
          row: i + 1,
          InvoiceNo: invoiceNo,
          type: 'sequence',
          message: `Non-sequential InvoiceNo in prefix series '${prefix}': ${lastNumberByPrefix[prefix]} followed by ${number}`
        });
      }
    }
    lastNumberByPrefix[prefix] = number;

    // Signature chain validation (skip first doc of series)
    let sigFail = false;
    if (prevHashByPrefix[prefix]) {
      const grossTotalFormatted = parseFloat(grossTotal).toFixed(2);
      const dataToVerify = [invoiceDate, systemEntryDate, invoiceNo, grossTotalFormatted, prevHashByPrefix[prefix]].join(';');
      let signature;
      try {
        signature = base64ToUint8Array(hashValue);
      } catch (e) {
        signatureFails++;
        sigFail = true;
        failedDocs.push({
          row: i + 1,
          InvoiceNo: invoiceNo,
          type: 'signature',
          message: `Failed to decode base64 Hash: ${e.message}`
        });
        continue;
      }
      const encoder = new TextEncoder();
      const data = encoder.encode(dataToVerify);
      let valid;
      try {
        valid = await window.crypto.subtle.verify(
          { name: 'RSASSA-PKCS1-v1_5' },
          cryptoKey,
          signature,
          data
        );
        if (!valid) {
          signatureFails++;
          sigFail = true;
          failedDocs.push({
            row: i + 1,
            InvoiceNo: invoiceNo,
            type: 'signature',
            message: `Signature verification failed. String: '${dataToVerify}'. Hash: '${hashValue}'`
          });
        }
      } catch (e) {
        signatureFails++;
        sigFail = true;
        failedDocs.push({
          row: i + 1,
          InvoiceNo: invoiceNo,
          type: 'signature',
          message: `Signature verification error: ${e.message}`
        });
      }
    }
    prevHashByPrefix[prefix] = hashValue;
    if (!seqFail && !sigFail) validCount++;
  }
  const status = (sequenceFails === 0 && signatureFails === 0) ? 'OK' : 'NOK';
  return {
    status,
    processed,
    seriesCount: seriesSet.size,
    validCount,
    sequenceFails,
    signatureFails,
    failedDocs,
    message: status === 'OK' ? 'All documents are valid.' : 'Some documents failed validation.'
  };
}

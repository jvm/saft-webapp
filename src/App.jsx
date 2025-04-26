import React, { useState } from 'react';
import Container from '@mui/material/Container';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { fetchXsdSchema, validateXmlWithXsd } from './utils/xmlValidation.js';
import { checkSequentiality } from './utils/sequentiality.js';
import { validateSignatureChain } from './utils/signatureChain.js';
import { extractExcelDocuments, validateExcelDocuments } from './utils/excelValidation.js';

export default function App() {
  const [xmlFile, setXmlFile] = useState(null);
  const [keyFile, setKeyFile] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [validating, setValidating] = useState(false);
  return (
    <Container maxWidth="sm" sx={{ mt: 6 }}>
      <Card>
        <CardContent>
          <Typography variant="h4" gutterBottom>
            SAF-T File Validator
          </Typography>
          <Typography variant="body1" gutterBottom>
            Validate your SAF-T XML file as specified by Autoridade Tributária. All processing is done locally in your browser.
          </Typography>
          <div style={{ marginTop: 32 }}>
            <input
              accept=".xml, .xlsx"
              style={{ display: 'none' }}
              id="upload-xml"
              type="file"
              onChange={e => {
                const file = e.target.files && e.target.files[0];
                setXmlFile(file);
                setValidationResult(null);
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
              <Button variant="contained" component="label" color="primary">
                Select SAF-T File
                <input
                  hidden
                  accept=".xml, .xlsx"
                  type="file"
                  onChange={e => {
                    const file = e.target.files && e.target.files[0];
                    setXmlFile(file);
                  }}
                />
              </Button>
              {xmlFile && <Alert severity="info" sx={{ mt: 1, mb: 1 }}>Selected File: {xmlFile.name}</Alert>}
              <Button variant="contained" component="label" color="secondary">
                Select Public Key File
                <input
                  hidden
                  accept=".pem,.crt,.cer,.key"
                  type="file"
                  onChange={e => {
                    const file = e.target.files && e.target.files[0];
                    setKeyFile(file);
                    setValidationResult(null);
                  }}
                />
              </Button>
              {keyFile && <Alert severity="info" sx={{ mt: 1, mb: 1 }}>Selected Key: {keyFile.name}</Alert>}
            </div>
          </div>
          <div style={{ marginTop: 32 }}>
            <button
              style={{ padding: '8px 20px', fontSize: 16 }}
              onClick={async () => {
                setShowDebug(false);
                setValidating(true);
                setValidationResult(null);
                try {
                  if (!xmlFile) return;
                  // Detect file type by extension
                  const fileName = xmlFile.name.toLowerCase();
                  if (fileName.endsWith('.xml')) {
                    // XML validation
                    const xmlText = await xmlFile.text();
                    const xsdText = await fetchXsdSchema();
                    const validationResult = await validateXmlWithXsd(xmlText, xsdText);
                    if (validationResult.errors && validationResult.errors.length > 0) {
                      setValidationResult({
                        ok: false,
                        message: 'XML does not conform to the SAF-T XSD schema. Errors: ' + validationResult.errors.join('; ')
                      });
                      setValidating(false);
                      return;
                    }
                    const seqResult = checkSequentiality(xmlText);
                    if (!seqResult.ok) {
                      let details = 'Sequentiality check failed: ' + seqResult.message;
                      if (seqResult.actual !== undefined && seqResult.expected !== undefined) {
                        details += ` (Read: ${seqResult.actual}, Expected: ${seqResult.expected})`;
                      }
                      setValidationResult({
                        ok: false,
                        message: details
                      });
                      setValidating(false);
                      return;
                    }
                    if (keyFile) {
                      try {
                        const pemText = await keyFile.text();
                        const result = await validateSignatureChain(xmlText, pemText);
                        setValidationResult(result);
                        setValidating(false);
                      } catch (err) {
                        setValidationResult({
                          status: 'NOK',
                          processed: 0,
                          seriesCount: 0,
                          validCount: 0,
                          sequenceFails: 0,
                          signatureFails: 0,
                          failedDocs: [],
                          message: 'Signature chain validation error: ' + err.message
                        });
                        setValidating(false);
                      }
                    } else {
                      setValidationResult({
                        status: 'OK',
                        processed: 0,
                        seriesCount: 0,
                        validCount: 0,
                        sequenceFails: 0,
                        signatureFails: 0,
                        failedDocs: [],
                        message: 'XML is well-formed and document numbers are sequential. (Signature chain not checked: no public key file provided)'
                      });
                      setValidating(false);
                    }
                  } else if (fileName.endsWith('.xlsx')) {
                    // Excel validation
                    const docs = await extractExcelDocuments(xmlFile);
                    if (docs.length === 0) {
                      setValidationResult({ ok: false, message: 'Excel file contains no documents.' });
                      setValidating(false);
                      return;
                    }
                    if (keyFile) {
                      const pemText = await keyFile.text();
                      const result = await validateExcelDocuments(docs, pemText);
                      setValidationResult(result);
                      setValidating(false);
                    } else {
                      // No signature check, only sequentiality (reuse validateExcelDocuments for stats, skip sig)
                      const result = await validateExcelDocuments(docs, null);
                      setValidationResult(result);
                      setValidating(false);
                    }
                  } else {
                    setValidationResult({ ok: false, message: 'Unsupported file type. Please upload an XML or Excel (.xlsx) file.' });
                    setValidating(false);
                  }
                } catch (err) {
                  setValidationResult({
                    ok: false,
                    message: 'Validation failed: ' + err.message
                  });
                  setValidating(false);
                }
              }}
              disabled={!xmlFile}
            >
              {validating ? 'Validating...' : 'Validate'}
            </button>
            {validationResult && (
              <Alert severity={validationResult.status === 'OK' ? 'success' : 'error'} sx={{ mt: 3, mb: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold">Validation Summary</Typography>
                <div>Status: <b>{validationResult.status}</b></div>
                <div>Processed documents: <b>{validationResult.processed}</b></div>
                <div>Series: <b>{validationResult.seriesCount}</b></div>
                <div>Valid documents: <b>{validationResult.validCount}</b></div>
                <div>Sequence fails: <b>{validationResult.sequenceFails}</b></div>
                <div>Signature fails: <b>{validationResult.signatureFails}</b></div>
                <div style={{ marginTop: 8 }}>{validationResult.message}</div>
                {validationResult.status === 'NOK' && validationResult.failedDocs && validationResult.failedDocs.length > 0 && (
                  <>
                    <Button size="small" variant="outlined" color="info" onClick={() => setShowDebug(v => !v)} sx={{ mt: 2, mb: 1 }}>
                      {showDebug ? 'Hide details' : 'More details'}
                    </Button>
                    {showDebug && (
                      <TableContainer component={Card} sx={{ mt: 1, maxHeight: 240 }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell>Row</TableCell>
                              <TableCell>InvoiceNo</TableCell>
                              <TableCell>Type</TableCell>
                              <TableCell>Message</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {validationResult.failedDocs.map(doc => (
                              <TableRow key={doc.row + '-' + doc.InvoiceNo}>
                                <TableCell>{doc.row}</TableCell>
                                <TableCell>{doc.InvoiceNo}</TableCell>
                                <TableCell>{doc.type}</TableCell>
                                <TableCell>{doc.message}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </>
                )}
              </Alert>
            )}
          </div>

        </CardContent>
      </Card>
    </Container>
  );
}

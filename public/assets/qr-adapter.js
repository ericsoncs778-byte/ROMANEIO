/* Local-only Android adapters. No operational data is sent to a network service. */
const qrCache = new Map();
function qrPalete(carga, numero) {
  const payload = JSON.stringify({romaneio: carga.id, palete: numero, codigo: codigoPalete(carga.id, numero)});
  if (!qrCache.has(payload)) {
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    // Four-module quiet zone; high-contrast raster image works offline and in PDF.
    qrCache.set(payload, qr.createDataURL(5, 20));
  }
  return qrCache.get(payload);
}

async function criarLeitorQR() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) return new BarcodeDetector({formats: ['qr_code']});
    } catch (_) { /* Fall back to the bundled reader. */ }
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  return {detect: async video => {
    if (!video.videoWidth || !video.videoHeight) return [];
    const ratio = Math.min(1, 720 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * ratio);
    canvas.height = Math.round(video.videoHeight * ratio);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, {inversionAttempts: 'dontInvert'});
    return result ? [{rawValue: result.data}] : [];
  }};
}

function imprimirAndroid(tipo) {
  const pages = [...document.querySelectorAll('.print-page')].filter(el =>
    tipo === 'juntos' || (tipo === 'crachas' ? el.classList.contains('pallet-sheet') : el.classList.contains('driver-sheet')));
  if (!pages.length) { alert('Selecione um romaneio para imprimir.'); return; }
  const styles = [...document.querySelectorAll('style')].map(el => el.textContent).join('\n');
  const bodyClass = tipo === 'juntos' ? 'print-juntos' : tipo === 'crachas' ? 'print-crachas' : 'print-romaneio';
  const copies = pages.map(el => { const clone = el.cloneNode(true); clone.style.display = ''; return clone.outerHTML; }).join('');
  const printCSS = '@page{size:A4 portrait;margin:8mm}' +
    'body{display:block!important;background:#fff!important}main{padding:0!important;margin:0!important}' +
    '.print-page{margin:0!important;break-after:page!important;page-break-after:always!important;break-inside:avoid!important}' +
    '.print-page:last-child{break-after:auto!important;page-break-after:auto!important}' +
    '.pallet-sheet{height:279mm!important;min-height:0!important;max-height:279mm!important;box-sizing:border-box!important}' +
    '.pallet-store{font-size:42px!important}.pallet-main{padding:20px!important}.pallet-head{padding:18px 22px!important}' +
    '.driver-sheet{min-height:0!important}.pallet-qr img{image-rendering:pixelated}' +
    '@media print{.pallet-sheet{height:279mm!important;min-height:0!important}}';
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' +
    '<title>Romaneio Hiperideal</title><style>' + styles + '\n' + printCSS + '</style></head>' +
    '<body class="' + bodyClass + '"><main>' + copies + '</main></body></html>';
  RomaneioAndroid.printDocument(html);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && typeof fecharCameraPalete === 'function') fecharCameraPalete();
});

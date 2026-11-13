const fs = require('fs');
const assert = require('assert/strict');
const {JSDOM} = require('jsdom');
const {parseGIF, decompressFrames} = require('gifuct-js');
const path = require('path');
const project = path.resolve(__dirname, '..');
const qrModule={exports:{}}; require('node:vm').runInNewContext(fs.readFileSync(path.join(project, 'public/assets/vendor/jsQR.js'),'utf8'), {module:qrModule,exports:qrModule.exports}); const jsQR=qrModule.exports;
const root = path.join(project, 'public/');
const results = path.join(project, 'test-results/operacao');
fs.mkdirSync(results, {recursive:true});
const source = fs.readFileSync(path.join(project, 'private/romaneio.html'), 'utf8').replace('/*__ROMANEIO_CONTEXT__*/', 'window.ROMANEIO_CONTEXT={userId:"test-operator",email:"operador@example.test",initialPage:"inicio"};');
const dom = new JSDOM(source, {url:'https://romaneio.example/app/inicio',runScripts:'outside-only',pretendToBeVisual:true});
const w = dom.window;
const alerts = [], prints = [], backups = [], checks = [];
w.alert = message => alerts.push(message);
w.confirm = () => true;
w.scrollTo = () => {};
w.AbortSignal = AbortSignal;
w.crypto.randomUUID = require('node:crypto').randomUUID;
const cloudRows = new Map();
w.fetch = async (url, options={}) => {
 if(options.method === 'POST') {
  const changes=JSON.parse(options.body).changes;
  assert.ok(changes.every(c=>(cloudRows.get(c.id)?.version||0)===c.expectedVersion));
  const rows=changes.map(c=>({id:c.id,payload:c.payload,version:c.expectedVersion+1}));
  rows.forEach(row=>cloudRows.set(row.id,structuredClone(row)));
  return new Response(JSON.stringify({rows}));
 }
 return new Response(JSON.stringify({rows:[...cloudRows.values()],next:null,canWrite:true}));
};
w.RomaneioAndroid = {printDocument: html => prints.push(html), saveBackup: json => backups.push(json)};
for (const script of [...w.document.scripts]) { if(script.getAttribute('src') === '/assets/session.js') continue; w.eval(script.src ? fs.readFileSync(root + script.getAttribute('src').slice(1),'utf8') : script.textContent); }
const ev = expression => w.eval(expression);
const byId = id => w.document.getElementById(id);
const field = (id,value) => { assert.ok(byId(id), id); byId(id).value = value; };
const check = text => { checks.push(text); console.log('PASS', text); };
const getDB = () => JSON.parse(w.localStorage.getItem('hiperideal_romaneio:test-operator') || '[]');

function decodeImage(uri) {
  const bytes = Buffer.from(uri.split(',')[1], 'base64');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const frame = decompressFrames(parseGIF(buffer), true)[0];
  return jsQR(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height).data;
}

(async () => {
  await w.romaneioCloudReady;
  ev("nav('cd')");
  for (const [id,value] of Object.entries({loja:'Amazonas',tipo:'CARGA SECA',endereco:'Endereço de teste',placa:'ABC1D23',motorista:'Motorista Teste',responsavelExpedicao:'Expedição Teste',fundo:'CD-F1',lateral:'CD-L1',qtdPaletes:'2'})) field(id,value);
  ev('gerarPaletes()');
  [...w.document.querySelectorAll('#paletes .nf')].forEach((input,i) => input.value = '100'+i);
  for (const [loja,tipo,temp,nf] of [['Apipema','HORTI','','200'],['Armação','FRIOS','3','300']]) {
    ev('adicionarLojaCompartilhada()');
    const section = w.document.querySelector('.loja-compartilhada:last-child');
    for (const [name,value] of Object.entries({'.loja-extra':loja,'.tipo-extra':tipo,'.temperatura-extra':temp,'.qtd-extra':'1'})) section.querySelector(name).value=value;
    w.gerarPaletesExtras(section);
    section.querySelector('.nf-extra').value=nf;
  }
  assert.equal(byId('formCD').checkValidity(), true);
  byId('formCD').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
  let data=getDB();
  assert.equal(data.length,3);
  assert.deepEqual(data.map(x=>x.paletes.length),[2,1,1]);
  assert.deepEqual(data.map(x=>x.tipo),['CARGA SECA','HORTI','FRIOS']);
  assert.equal(data[1].fundo,null);
  check('Emissão com 3 lojas, paletes e tipos independentes, lacres adicionais não exigidos no CD');
  const firstQR = w.document.querySelector('.pallet-qr img').src;
  const raw = decodeImage(firstQR), qr = JSON.parse(raw);
  assert.equal(qr.romaneio,data[0].id);
  assert.equal(qr.palete,1);
  assert.equal(qr.codigo,ev(`codigoPalete('${data[0].id}',1)`));
  check('QR Code real gerado no app e decodificado offline com jsQR');
  for (const [tipo,count] of [['romaneio',1],['crachas',2],['juntos',3]]) {
    ev(`imprimir('${tipo}')`);
    const doc = new JSDOM(prints.at(-1));
    assert.equal(doc.window.document.querySelectorAll('.print-page').length,count);
    assert.equal(doc.window.document.querySelectorAll('script').length,0);
    assert.equal(doc.window.document.querySelectorAll('img[src^="http"]').length,0);
    doc.window.close();
  }
  fs.writeFileSync(path.join(results,'print_smoke.html'),prints.at(-1));
  check('Ponte de impressão: romaneio, crachás e conjunto com 1/2/3 folhas lógicas, sem imagens externas');
  await ev('saida()');
  assert.ok(getDB().every(x=>x.saida));
  ev("nav('loja');renderLoja('Apipema')");
  field('enc_'+data[1].id,'Encarregado');field('conf_'+data[1].id,'Conferente');
  await ev(`chegada('${data[1].id}')`);
  assert.equal(getDB()[1].chegada,null);
  assert.match(alerts.at(-1),/anterior/);
  check('Loja 2 bloqueada antes de a Loja 1 finalizar e informar lacres');
  for (let i=0;i<3;i++) {
    const cargo=data[i];
    ev(`nav('loja');renderLoja('${cargo.loja}')`);
    field('enc_'+cargo.id,'Encarregado '+i);field('conf_'+cargo.id,'Conferente '+i);
    await ev(`chegada('${cargo.id}')`);ev(`conferir('${cargo.id}')`);
    field('lacre_fundo_receb','ERRADO');field('lacre_lateral_receb','ERRADO');
    await ev(`validarLacres('${cargo.id}')`);
    assert.ok(!getDB()[i].lacresValidados);
    field('lacre_fundo_receb', i===0?'CD-F1':'LOJA-F'+i);
    field('lacre_lateral_receb',i===0?'CD-L1':'LOJA-L'+i);
    await ev(`validarLacres('${cargo.id}')`);
    assert.ok(getDB()[i].lacresValidados);
    if (i===0) {
      field('codigo_palete_1',JSON.stringify({...qr,romaneio:'OUTRO'}));
      await ev('validarPalete(1)');assert.equal(getDB()[i].conferidos.length,0);
      const bytes=Buffer.from(firstQR.split(',')[1],'base64');
      const frame=decompressFrames(parseGIF(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),true)[0];
      w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){},getImageData(){return {data:new Uint8ClampedArray(frame.patch),width:frame.dims.width,height:frame.dims.height}}});
      Object.defineProperty(w,'isSecureContext',{value:true,configurable:true});
      delete w.BarcodeDetector;
      Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>{throw new Error('Permission denied')}},configurable:true});
      await w.abrirCameraPalete(1);
      assert.equal(byId('modalCameraPalete'),null);
      let stopped=false;
      Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async constraints=>{
        assert.equal(constraints.audio,false);
        return {getTracks:()=>[{stop(){stopped=true}}]};
      }},configurable:true});
      w.HTMLMediaElement.prototype.play=async()=>{};
      for (const [key,value] of Object.entries({readyState:2,videoWidth:frame.dims.width,videoHeight:frame.dims.height}))
        Object.defineProperty(w.HTMLVideoElement.prototype,key,{get:()=>value,configurable:true});
      await w.abrirCameraPalete(1);
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(stopped,true);
      assert.equal(byId('modalCameraPalete'),null);
      check('Câmera simulada: permissão negada fecha a tela; vídeo com QR real usa fallback sem BarcodeDetector e interrompe os tracks');
      assert.equal(getDB()[i].conferidos.length,1);
      await ev('validarPalete(1)');assert.equal(getDB()[i].conferidos.length,1);
      field('codigo_palete_2',ev(`codigoPalete('${cargo.id}',2)`));await ev('validarPalete(2)');
    } else {field('codigo_palete_1',ev(`codigoPalete('${cargo.id}',1)`));await ev('validarPalete(1)');}
    if (i===0) {
      field('ret_palete','sim');ev("alternarRetorno('palete')");
      await ev(`finalizarRetorno('${cargo.id}')`);assert.equal(getDB()[i].fim,null);
      field('qtd_palete','3');field('nf_palete','RET-123');
    }
    if(i<2){
      await ev(`finalizarRetorno('${cargo.id}')`);assert.equal(getDB()[i].fim,null);
      field('novo_lacre_fundo','LOJA-F'+(i+1));field('novo_lacre_lateral','LOJA-L'+(i+1));
    } else assert.equal(byId('novo_lacre_fundo'),null);
    await ev(`finalizarRetorno('${cargo.id}')`);
    assert.ok(getDB()[i].fim);
    assert.ok(!byId('enc_'+cargo.id));
    assert.ok(!byId('conf_'+cargo.id));
    assert.match(byId('lojaLista').textContent,/CONFERÊNCIA CONCLUÍDA/);
  }
  check('Recebimento completo em 3 lojas, lacres sequenciais, retornáveis obrigatórios e limpeza dos nomes');
  assert.equal(getDB()[0].retornaveis.palete.quantidade,3);
  assert.equal(getDB()[2].lacresFechamento,null);
  check('QR de outro palete/carga, lacre errado, repetição de conferência e fechamento sem novos lacres recusados');
  ev('exportarBackup()');const backup=JSON.parse(backups.at(-1));
  assert.equal(backup.cargas.length,3);assert.equal(backup.cargas[0].conferente,'Conferente 0');
  assert.equal(JSON.parse(w.localStorage.getItem('hiperideal_romaneio:test-operator')).length,3);
  const file = {files:[{size:backups.at(-1).length,text:async()=>backups.at(-1)}]};
  await w.importarBackup(file);
  assert.equal(getDB().length,3);assert.ok(getDB().every(x=>x.fim));
  check('Backup JSON via ponte Android, importação e persistência local dos dados e responsáveis');
  const allImgs=[...w.document.querySelectorAll('img')];
  assert.ok(allImgs.every(img=>!img.src.startsWith('http')));
  check('Assets locais, sem dependência de serviço externo de QR ou fontes');
  fs.writeFileSync(path.join(results,'smoke-results.json'),JSON.stringify({checks,alerts,scope:'DOM simulado com JSDOM; não é emulador Android nem navegador real'},null,2));
  w.close();
})().catch(error=>{console.error(error);w.close();process.exitCode=1;});

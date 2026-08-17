<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AunordMED — Comprovante de Repasse</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{--green:#0D7A40;--green-light:#E6F4ED;--green-dark:#064D27;--gray0:#0F172A;--gray1:#1E293B;--gray2:#334155;--gray3:#64748B;--gray4:#94A3B8;--gray5:#CBD5E1;--gray6:#E2E8F0;--gray7:#F1F5F9;--gray8:#F8FAFC;--mono:'JetBrains Mono',monospace;--radius:12px}
body{font-family:'Inter',system-ui,sans-serif;background:#F1F5F9;color:var(--gray0);min-height:100vh;padding:24px 16px}
/* LOADING */
.lov{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:14px;background:#F1F5F9}
.spin-big{width:40px;height:40px;border:3px solid var(--green-light);border-top-color:var(--green);border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
/* WRAPPER */
.wrapper{max-width:520px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
/* HEADER CARD */
.header-card{background:#fff;border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.hc-top{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--gray6)}
.logo-area{}
.logo-name{font-size:17px;font-weight:800;color:var(--green-dark);letter-spacing:-.3px}
.logo-name span{color:var(--green)}
.logo-sub{font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--gray4);margin-top:1px}
.doc-info{text-align:right}
.doc-num{font-size:12px;font-weight:700;color:var(--gray2);font-family:var(--mono)}
.doc-data{font-size:10px;color:var(--gray4);margin-top:2px}
/* MÉDICO */
.medico-row{display:flex;align-items:center;gap:14px;padding:18px 22px}
.avatar{width:44px;height:44px;border-radius:50%;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0}
.medico-nome{font-size:16px;font-weight:700;color:var(--gray0);line-height:1.2}
.medico-crm{font-size:11px;color:var(--gray4);margin-top:2px}
.medico-esp{font-size:11px;color:var(--green);margin-top:1px;font-weight:500}
.status-pill{display:inline-flex;align-items:center;gap:4px;background:var(--green-light);color:var(--green);border-radius:99px;padding:3px 10px;font-size:10px;font-weight:600;margin-top:6px}
/* VALOR CARD */
.valor-card{background:#fff;border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.vc-header{padding:22px 22px 18px;border-bottom:1px solid var(--gray6)}
.vc-label{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--gray4);font-weight:600;margin-bottom:8px}
.vc-valor{font-size:38px;font-weight:800;color:var(--green-dark);font-family:var(--mono);line-height:1;letter-spacing:-1px}
.vc-valor sup{font-size:16px;font-weight:600;vertical-align:super;margin-right:3px;color:var(--green)}
.vc-seq{font-size:28px;font-weight:800;color:var(--gray6);font-family:var(--mono)}
.vc-grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
.vc-item{padding:14px 22px;border-bottom:1px solid var(--gray6);border-right:1px solid var(--gray6)}
.vc-item:nth-child(even){border-right:none}
.vc-item:last-child{grid-column:span 2;border-bottom:none}
.vc-item-lbl{font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:var(--gray4);font-weight:600;margin-bottom:5px}
.vc-item-val{font-size:13px;font-weight:600;color:var(--gray1)}
.pix-row{display:flex;align-items:center;gap:12px;padding:14px 22px;border-top:1px solid var(--gray6);background:var(--gray8)}
.pix-ic{font-size:22px}
.pix-lbl{font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:var(--gray4);font-weight:600;margin-bottom:3px}
.pix-val{font-size:13px;font-weight:600;color:var(--gray1);font-family:var(--mono)}
/* RESUMO */
.resumo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--gray6);border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.rg-item{background:#fff;padding:14px 14px;text-align:center}
.rg-lbl{font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:var(--gray4);font-weight:600;margin-bottom:6px}
.rg-val{font-size:14px;font-weight:700;color:var(--gray0);font-family:var(--mono)}
.rg-sub{font-size:9px;color:var(--gray4);margin-top:3px}
/* AÇÕES */
.acoes-card{background:#fff;border-radius:var(--radius);padding:16px 22px;display:flex;gap:10px;flex-wrap:wrap;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.btn-ghost{display:flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--gray6);border-radius:8px;background:#fff;color:var(--gray2);font-size:12px;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s}
.btn-ghost:hover{border-color:var(--green);color:var(--green)}
.wpp{background:var(--green)!important;color:#fff!important;border-color:var(--green)!important}
.wpp:hover{background:var(--green-dark)!important}
.btn-copy{display:flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--gray6);border-radius:8px;background:#fff;color:var(--gray2);font-size:12px;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s}
.btn-copy:hover{border-color:var(--green);color:var(--green)}
/* HISTÓRICO */
.hist-card{background:#fff;border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.hist-card h3{font-size:12px;font-weight:700;color:var(--gray2);padding:16px 22px;border-bottom:1px solid var(--gray6)}
.hist-table{width:100%;border-collapse:collapse;font-size:12px}
.hist-table th{padding:10px 14px;text-align:left;font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:var(--gray4);font-weight:600;border-bottom:1px solid var(--gray6);background:var(--gray8)}
.hist-table td{padding:11px 14px;border-bottom:1px solid var(--gray7);color:var(--gray2)}
.hist-table tr:last-child td{border-bottom:none}
.hist-table tr:hover td{background:var(--gray8)}
.mono{font-family:var(--mono)!important}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}
.b-ok{background:var(--green-light);color:var(--green)}
.b-pag{background:#EFF6FF;color:#2563EB}
.b-rec{background:#FFF7ED;color:#C2410C}
.b-emit{background:#FEF9C3;color:#A16207}
/* PRINT FOOTER */
.print-footer{text-align:center;padding:12px;display:none}
.pf-logo{font-size:13px;font-weight:800;color:var(--green-dark)}
.pf-logo span{color:var(--green)}
.pf-info{font-size:10px;color:var(--gray4);margin-top:3px}
/* ERR */
.err{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:32px;gap:8px}
.err-icon{font-size:56px;margin-bottom:8px}
.err h2{font-size:18px;font-weight:700;color:var(--gray1)}
.err p{font-size:13px;color:var(--gray3);max-width:360px;line-height:1.6}

/* ══ DASHBOARD 3D ═══════════════════════════════ */
@keyframes fadeUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:translateY(0)}}
@keyframes lineIn{from{stroke-dashoffset:2000}to{stroke-dashoffset:0}}
@keyframes dotPop{0%{r:0;opacity:0}80%{r:7}100%{r:5;opacity:1}}
.dsh{border-radius:var(--radius);overflow:hidden;background:#020c06;border:1px solid rgba(74,222,128,.15);box-shadow:0 1px 3px rgba(0,0,0,.06)}
.dsh-3d{position:relative;height:210px;overflow:hidden;background:#020c06}
.dsh-3d canvas{width:100%!important;height:210px!important;display:block}
.dsh-3d-fade{position:absolute;inset:0;background:linear-gradient(to bottom,transparent 45%,#020c06 100%);pointer-events:none;z-index:2}
.dsh-kpis-top{position:absolute;top:14px;left:0;right:0;display:grid;grid-template-columns:repeat(3,1fr);z-index:3;pointer-events:none}
.dsh-kt{text-align:center;animation:fadeUp .5s ease both}
.dsh-kt:nth-child(2){animation-delay:.08s}
.dsh-kt:nth-child(3){animation-delay:.16s}
.dsh-kt-lbl{font-size:9px;letter-spacing:1.8px;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:3px;font-weight:600}
.dsh-kt-val{font-size:17px;font-weight:700;font-family:'JetBrains Mono',monospace;color:#4ade80;line-height:1}
.dsh-kt-sub{font-size:9px;color:rgba(255,255,255,.22);margin-top:3px}
.dsh-id{position:absolute;bottom:16px;left:0;right:0;text-align:center;z-index:3;pointer-events:none;animation:fadeUp .5s .3s ease both;opacity:0;animation-fill-mode:forwards}
.dsh-id-eye{font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:rgba(74,222,128,.4);margin-bottom:3px}
.dsh-id-name{font-size:15px;font-weight:700;color:#fff}
.dsh-id-per{font-size:10px;color:rgba(255,255,255,.28);margin-top:2px}
.dsh-body{display:grid;grid-template-columns:1fr;background:#020c06}
.dsh-col{padding:18px 20px;border-top:1px solid rgba(74,222,128,.08);border-right:none}
.dsh-col-title{font-size:9px;letter-spacing:1.8px;text-transform:uppercase;color:rgba(74,222,128,.5);margin-bottom:13px;font-weight:600}
.dsh-hrow{display:flex;align-items:center;gap:7px;margin-bottom:7px;animation:fadeUp .4s ease both}
.dsh-hrow:last-of-type{margin-bottom:0}
.dsh-hlbl{font-size:11px;color:#fff;width:46px;text-align:right;flex-shrink:0;font-weight:500}
.dsh-htrack{flex:1;background:rgba(255,255,255,.04);border-radius:20px;height:15px;position:relative;overflow:hidden}
.dsh-hfill{height:100%;border-radius:20px;position:absolute;left:0;top:0;width:0;transition:width 1.1s cubic-bezier(.34,1.4,.64,1);background:linear-gradient(90deg,#052e16,#16a34a,#4ade80)}
.dsh-hrep{height:100%;border-radius:20px;position:absolute;left:0;top:0;width:0;transition:width 1.1s cubic-bezier(.34,1.4,.64,1) .1s;background:linear-gradient(90deg,rgba(74,222,128,.2),rgba(74,222,128,.1))}
.dsh-hval{font-size:10px;font-family:'JetBrains Mono',monospace;color:#4ade80;width:62px;flex-shrink:0;font-weight:600}
.dsh-lgd{display:flex;gap:10px;margin-top:11px;padding-top:9px;border-top:1px solid rgba(74,222,128,.07);font-size:10px;color:rgba(255,255,255,.3)}
.dsh-lgd span{display:flex;align-items:center;gap:4px}
.dsh-lgd i{width:10px;height:4px;border-radius:2px;display:inline-block}

/* ══ PRINT ══════════════════════════════════════ */
@media print{
  body{background:#fff;padding:0}
  .acoes-card,.hist-card .hist-filter{display:none!important}
  .print-footer{display:block}
  .wrapper{gap:8px}
}
</style>
</head>
<body>
<div class="lov" id="lov"><div class="spin-big"></div><span>Carregando comprovante...</span></div>

<div class="wrapper" id="wrapper" style="display:none">

  <!-- HEADER -->
  <div class="header-card">
    <div class="hc-top">
      <div class="logo-area">
        <div class="logo-name">Aunord<span>MED</span></div>
        <div class="logo-sub">FINANCEIRO</div>
      </div>
      <div class="doc-info">
        <div class="doc-num" id="doc-num">Comprovante #—</div>
        <div class="doc-data" id="doc-data">—</div>
      </div>
    </div>
    <div class="medico-row">
      <div class="avatar" id="avatar">—</div>
      <div>
        <div class="medico-nome" id="med-nome">—</div>
        <div class="medico-crm" id="med-crm">—</div>
        <div class="medico-esp" id="med-esp"></div>
        <div class="status-pill">✓ Repasse efetuado</div>
      </div>
    </div>
  </div>

  <!-- VALOR -->
  <div class="valor-card">
    <div class="vc-header">
      <div>
        <div class="vc-label">Valor do repasse</div>
        <div class="vc-valor"><sup>R$</sup><span id="vc-valor">0,00</span></div>
      </div>
      <div class="vc-seq" id="vc-seq">#001</div>
    </div>
    <div class="vc-grid">
      <div class="vc-item"><div class="vc-item-lbl">Data do pagamento</div><div class="vc-item-val" id="vc-data">—</div></div>
      <div class="vc-item"><div class="vc-item-lbl">Competência</div><div class="vc-item-val" id="vc-comp">—</div></div>
      <div class="vc-item"><div class="vc-item-lbl">Tomador</div><div class="vc-item-val" id="vc-tomador">—</div></div>
    </div>
    <div class="pix-row" id="pix-row" style="display:none">
      <div class="pix-ic">🏧</div>
      <div><div class="pix-lbl">Chave PIX</div><div class="pix-val" id="pix-val">—</div></div>
    </div>
  </div>

  <!-- RESUMO MÊS -->
  <div class="resumo-grid" id="resumo-grid"></div>

        <!-- DASHBOARD FATURAMENTO -->
  <div class="dsh" id="dash-card" style="display:none">
    <div class="dsh-3d">
      <canvas id="dsh-3d"></canvas>
      <div class="dsh-3d-fade"></div>
      <div class="dsh-kpis-top">
        <div class="dsh-kt">
          <div class="dsh-kt-lbl">Total bruto</div>
          <div class="dsh-kt-val" id="dk-bruto">—</div>
          <div class="dsh-kt-sub">acumulado</div>
        </div>
        <div class="dsh-kt">
          <div class="dsh-kt-lbl">Total repasse</div>
          <div class="dsh-kt-val" id="dk-repasse" style="color:#86efac">—</div>
          <div class="dsh-kt-sub">após retenção</div>
        </div>
        <div class="dsh-kt">
          <div class="dsh-kt-lbl">NFs vinculadas</div>
          <div class="dsh-kt-val" id="dk-nfs" style="color:#93c5fd">—</div>
          <div class="dsh-kt-sub">total de notas</div>
        </div>
      </div>
      <div class="dsh-id">
        <div class="dsh-id-eye">AunordMED · Faturamento</div>
        <div class="dsh-id-name" id="dash-nome-med">—</div>
        <div class="dsh-id-per" id="dash-periodo">—</div>
      </div>
    </div>
    <div class="dsh-body">
      <div class="dsh-col">
        <div class="dsh-col-title">Faturamento mensal</div>
        <div id="dash-bars"></div>
        <div class="dsh-lgd">
          <span><i style="background:linear-gradient(90deg,#052e16,#4ade80)"></i>Bruto</span>
          <span><i style="background:rgba(74,222,128,.25)"></i>Repasse</span>
        </div>
      </div>

    </div>
  </div>

  <!-- HISTÓRICO -->
  <div class="hist-card">
    <div class="hist-hd">
      <h3>📋 Histórico de notas fiscais</h3>
      <div class="hist-filtro">
        <select id="hist-mes" onchange="renderHistorico()">
          <option value="">Todos os meses</option>
        </select>
      </div>
    </div>
    <div id="hist-wrap"></div>
    <div class="hist-total" id="hist-total" style="display:none">
      <span>Total no período</span>
      <strong id="hist-total-val">R$ 0,00</strong>
    </div>
  </div>

  <!-- AÇÕES (não aparece na impressão) -->
  <div class="acoes-card">
    <div class="acoes-title">Compartilhar comprovante</div>
    <div class="acoes-row">
      <button class="btn btn-wpp" onclick="enviarWhatsApp()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.535 5.858L.057 23.633a.5.5 0 00.61.61l5.775-1.478A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.795 9.795 0 01-5.031-1.392l-.361-.214-3.731.955.971-3.625-.235-.373A9.784 9.784 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
        Enviar por WhatsApp
      </button>
      <button class="btn btn-copy" onclick="copiarLink()">🔗 Copiar link</button>
      <button class="btn btn-print" onclick="imprimirComp()">🖨️ Imprimir</button>
    </div>
    <div class="link-box">
      <span id="link-txt"></span>
      <button class="btn btn-ghost" onclick="copiarLink()">Copiar</button>
    </div>
  </div>

  <!-- RODAPÉ DE IMPRESSÃO -->
  <div class="print-footer">
    <div>
      <div class="pf-logo">Aunord<span>MED</span> Financeiro</div>
      <div style="font-size:10px;color:var(--gray3);margin-top:2px">Documento gerado em <span id="print-data"></span></div>
    </div>
    <div class="pf-info">
      <div id="print-num" style="font-weight:600;color:var(--gray2)"></div>
      <div style="margin-top:2px">Documento válido apenas como comprovante interno</div>
    </div>
  </div>

  <div class="footer">Gerado por <strong>AunordMED Financeiro</strong> · <span id="footer-data"></span></div>
</div>

<div class="toast" id="toast"></div>

<script>
const SUPA_URL='https://hleesgnzpkjuhjshyaal.supabase.co';
const SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZWVzZ256cGtqdWhqc2h5YWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzODczMTksImV4cCI6MjA5Nzk2MzMxOX0.jnVO9Bqo-s5DPK0-tFeYr_UeBaEkXCmVa2xhA93aVDk';
const H={'Content-Type':'application/json','apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY,'Prefer':'return=representation'};
async function sGet(t,q=''){const r=await fetch(`${SUPA_URL}/rest/v1/${t}?${q}`,{headers:H});if(!r.ok)throw new Error(await r.text());return r.json();}
async function sPatch(t,id,b){const r=await fetch(`${SUPA_URL}/rest/v1/${t}?id=eq.${id}`,{method:'PATCH',headers:H,body:JSON.stringify(b)});if(!r.ok)throw new Error(await r.text());return r.json();}

let comp=null,medico=null,notas=[],numSeq=1;
let cfg={wppUrl:'',wppKey:'',wppInst:'aunordmed'};

const brl=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtMes=m=>{if(!m)return'—';const[y,mo]=m.split('-');const ms=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];return`${ms[+mo-1]}/${y}`;};
const fmtDt=d=>{if(!d)return'—';const p=d.split('T')[0].split('-');return`${p[2]}/${p[1]}/${p[0]}`;};
const ini=n=>n.split(' ').filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('');
const avc=n=>{const cs=['#22994D','#1A56DB','#D97706','#7C3AED','#DB2777','#0891B2'];let h=0;for(let c of n)h=(h*31+c.charCodeAt(0))%cs.length;return cs[Math.abs(h)];};
const pad=n=>String(n).padStart(3,'0');

function toast(m,tp=''){const e=document.getElementById('toast');e.textContent=m;e.className='toast '+(tp||'');e.classList.add('show');setTimeout(()=>e.classList.remove('show'),3000);}
function getToken(){return new URLSearchParams(window.location.search).get('token')||new URLSearchParams(window.location.search).get('t');}

async function init(){
  const s=localStorage.getItem('am_cfg4');if(s)cfg={...cfg,...JSON.parse(s)};
  const token=getToken();
  const hoje=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  document.getElementById('footer-data').textContent=hoje;
  document.getElementById('print-data').textContent=hoje;
  document.getElementById('link-txt').textContent=window.location.href;

  if(!token){mostrarDemo();return;}
  try{
    // Buscar comprovante
    let comps;
    try {
      comps=await sGet('comprovantes',`token=eq.${token}&limit=1`);
    } catch(e) {
      mostrarErro('Erro ao acessar o banco de dados. Verifique as permissões RLS no Supabase (tabela comprovantes precisa de policy SELECT público). Detalhe: '+e.message);
      return;
    }
    if(!comps||!comps.length){mostrarErro('Comprovante não encontrado. Verifique se o link está correto ou se o token existe na tabela.');return;}
    comp=comps[0];

    // Incrementar visualizações
    sPatch('comprovantes',comp.id,{visualizacoes:(comp.visualizacoes||0)+1}).catch(()=>{});

    // Buscar médico
    const meds=await sGet('medicos',`nome=eq.${encodeURIComponent(comp.medico_nome)}&limit=1`).catch(()=>[]);
    medico=meds[0]||null;

    // Buscar todas as notas do médico para histórico
    const todasNotas=await sGet('notas_fiscais','order=criado_em.asc').catch(()=>[]);
    notas=todasNotas.filter(n=>n.medicos_nota?.some(mn=>mn.nome===comp.medico_nome)||n.nomes_medicos?.includes(comp.medico_nome));

    // Calcular número sequencial: quantos comprovantes este médico tem até este
    const todosComps=await sGet('comprovantes',`medico_nome=eq.${encodeURIComponent(comp.medico_nome)}&order=criado_em.asc`).catch(()=>[]);
    const idx=todosComps.findIndex(c=>c.token===token);
    numSeq=idx>=0?idx+1:1;

    renderComprovante();
  }catch(e){mostrarErro('Erro: '+e.message);}
}

function mostrarDemo(){
  comp={token:'demo',medico_nome:'Dr. João Silva',medico_crm:'CRM/SE 12345',tomador:'Unimed Sergipe',valor_repasse:4250.00,data_pagamento:new Date().toISOString().split('T')[0],competencia:new Date().toISOString().substring(0,7),dados_extras:{nf:'00042',pix:'123.456.789-00',tipo_pix:'CPF'}};
  medico={especialidade:'Clínica Médica',chave_pix:'123.456.789-00',tipo_pix:'cpf',telefone_whatsapp:'5511999999999'};
  notas=[
    {nf:'00042',tomador:'Unimed Sergipe',comp:new Date().toISOString().substring(0,7),status:'Paga ao médico',medicos_nota:[{nome:'Dr. João Silva',valor_bruto_medico:5000,repasse:4350}]},
    {nf:'00038',tomador:'Bradesco Saúde',comp:new Date(Date.now()-30*24*3600000).toISOString().substring(0,7),status:'Paga ao médico',medicos_nota:[{nome:'Dr. João Silva',valor_bruto_medico:3800,repasse:3306}]},
    {nf:'00031',tomador:'Unimed Sergipe',comp:new Date(Date.now()-60*24*3600000).toISOString().substring(0,7),status:'Paga ao médico',medicos_nota:[{nome:'Dr. João Silva',valor_bruto_medico:4200,repasse:3654}]},
  ];
  numSeq=3;
  renderComprovante();
}

function mostrarErro(msg){
  document.getElementById('lov').classList.add('hide');
  document.getElementById('wrapper').style.display='block';
  document.getElementById('wrapper').innerHTML=`<div style="text-align:center;padding:60px 20px;background:#fff;border-radius:20px"><div style="font-size:48px;margin-bottom:16px">❌</div><h2 style="color:#1E293B;margin-bottom:8px">Comprovante não encontrado</h2><p style="color:#94A3B8">${msg}</p></div>`;
}

function renderComprovante(){
  document.getElementById('lov').classList.add('hide');
  document.getElementById('wrapper').style.display='block';

  const nome=comp.medico_nome||'—';
  const numStr=`#${pad(numSeq)}`;

  document.getElementById('doc-num').textContent=`Comprovante ${numStr}`;
  document.getElementById('doc-data').textContent=`Emitido em ${new Date().toLocaleDateString('pt-BR')}`;
  document.getElementById('print-num').textContent=`Comprovante ${numStr}`;
  document.getElementById('avatar').textContent=ini(nome);
  document.getElementById('avatar').style.background=avc(nome);
  document.getElementById('med-nome').textContent=nome;
  document.getElementById('med-crm').textContent=comp.medico_crm||medico?.crm||'—';
  if(medico?.especialidade)document.getElementById('med-esp').textContent=medico.especialidade;

  document.getElementById('vc-seq').textContent=numStr;
  document.getElementById('vc-valor').textContent=brl(comp.valor_repasse);
  document.getElementById('vc-data').textContent=comp.data_pagamento ? fmtDt(comp.data_pagamento) : fmtMes(comp.competencia)+' (competência)';
  document.getElementById('vc-comp').textContent=fmtMes(comp.competencia);
  document.getElementById('vc-tomador').textContent=comp.tomador||'—';

  const pix=comp.dados_extras?.pix||medico?.chave_pix;
  if(pix){
    document.getElementById('pix-row').style.display='flex';
    document.getElementById('pix-val').textContent=`${(comp.dados_extras?.tipo_pix||medico?.tipo_pix||'PIX').toUpperCase()}: ${pix}`;
  }

  renderResumo();
  renderFiltroMes();
  renderHistorico();
  renderDash();
}

function renderResumo(){
  const mes=comp.competencia;
  const nm=notas.filter(n=>n.comp===mes);
  const tBruto=nm.reduce((a,n)=>{const mn=n.medicos_nota?.find(mn=>mn.nome===comp.medico_nome);return a+(mn?.valor_bruto_medico||0);},0);
  const tRep=nm.reduce((a,n)=>{const mn=n.medicos_nota?.find(mn=>mn.nome===comp.medico_nome);return a+(mn?.repasse||0);},0);
  document.getElementById('resumo-grid').innerHTML=`
    <div class="rg-item"><div class="rg-lbl">NFs no mês</div><div class="rg-val">${nm.length}</div><div class="rg-sub">${fmtMes(mes)}</div></div>
    <div class="rg-item"><div class="rg-lbl">Bruto no mês</div><div class="rg-val">R$ ${brl(tBruto)}</div><div class="rg-sub">Valor emitido</div></div>
    <div class="rg-item"><div class="rg-lbl">Repasse no mês</div><div class="rg-val" style="color:var(--g2)">R$ ${brl(tRep)}</div><div class="rg-sub">Valor líquido</div></div>`;
}

function renderFiltroMes(){
  const meses=[...new Set(notas.map(n=>n.comp).filter(Boolean))].sort().reverse();
  const sel=document.getElementById('hist-mes');
  sel.innerHTML='<option value="">Todos os meses</option>'+meses.map(m=>`<option value="${m}"${m===comp.competencia?' selected':''}>${fmtMes(m)}</option>`).join('');
}

function renderHistorico(){
  const mesFiltro=document.getElementById('hist-mes').value;
  const f=notas.filter(n=>!mesFiltro||n.comp===mesFiltro);
  const wrap=document.getElementById('hist-wrap');
  const tot=document.getElementById('hist-total');
  if(!f.length){wrap.innerHTML=`<div class="hist-empty">Nenhuma nota encontrada neste período</div>`;tot.style.display='none';return;}
  const totalRep=f.reduce((a,n)=>{const mn=n.medicos_nota?.find(mn=>mn.nome===comp.medico_nome);return a+(mn?.repasse||0);},0);
  wrap.innerHTML=`<table class="hist-table">
    <thead><tr><th>NF</th><th>Tomador</th><th>Competência</th><th>Bruto</th><th>Repasse</th><th>Status</th></tr></thead>
    <tbody>${f.map(n=>{
      const mn=n.medicos_nota?.find(mn=>mn.nome===comp.medico_nome);
      const bdg=n.status==='Paga ao médico'?'b-pag':n.status==='Recebida'?'b-rec':'b-emit';
      const lbl=n.status==='Paga ao médico'?'✓ Pago':n.status==='Recebida'?'Recebida':'Emitida';
      return`<tr><td class="mono" style="font-weight:600">${n.nf||'—'}</td><td>${n.tomador||'—'}</td><td class="mono">${fmtMes(n.comp)}</td><td class="mono">R$ ${brl(mn?.valor_bruto_medico||0)}</td><td class="mono" style="font-weight:600;color:var(--g2)">R$ ${brl(mn?.repasse||0)}</td><td><span class="badge ${bdg}">${lbl}</span></td></tr>`;
    }).join('')}</tbody>
  </table>`;
  tot.style.display='flex';
  document.getElementById('hist-total-val').textContent=`R$ ${brl(totalRep)}`;
}

var _dshRaf=null,_dshR=null;

function initDsh3D(meses){
  var cv=document.getElementById('dsh-3d');
  if(!cv||!window.THREE)return;
  if(_dshRaf){cancelAnimationFrame(_dshRaf);_dshRaf=null;}
  if(_dshR){_dshR.dispose();_dshR=null;}
  var W=cv.offsetWidth||340,H=210;
  cv.width=W*devicePixelRatio;cv.height=H*devicePixelRatio;
  var R=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});
  R.setSize(W,H);R.setPixelRatio(devicePixelRatio);R.setClearColor(0x000000,0);
  _dshR=R;
  var S=new THREE.Scene();
  var CAM=new THREE.PerspectiveCamera(42,W/H,.1,100);
  CAM.position.set(0,3.8,10);CAM.lookAt(0,0,0);
  var maxB=Math.max.apply(null,meses.map(function(m){return m.bruto;}));
  if(!maxB)maxB=1;
  var n=meses.length,sp=2.1,off=-(n-1)*sp/2;
  var bars=[];
  meses.forEach(function(m,i){
    var h=Math.max((m.bruto/maxB)*4,.2);
    var hr=Math.max((m.repasse/maxB)*4,.1);
    var x=off+i*sp;
    // Barra bruto
    var g=new THREE.BoxGeometry(.82,h,.82);
    var mat=new THREE.MeshStandardMaterial({color:0x16a34a,emissive:0x052e16,emissiveIntensity:.55,metalness:.65,roughness:.28});
    var b=new THREE.Mesh(g,mat);
    b.position.set(x,-2,0);b.userData.finalY=(h/2)-2;b.scale.y=.001;
    S.add(b);bars.push({m:b,delay:i*.12});
    // Borda wireframe
    var eg=new THREE.EdgesGeometry(g);
    var em=new THREE.LineBasicMaterial({color:0x4ade80,transparent:true,opacity:.18});
    var el=new THREE.LineSegments(eg,em);
    el.position.copy(b.position);S.add(el);
    // Barra repasse (frente)
    var g2=new THREE.BoxGeometry(.52,hr,.52);
    var m2=new THREE.MeshStandardMaterial({color:0x4ade80,emissive:0x14532d,emissiveIntensity:.65,metalness:.5,roughness:.2,transparent:true,opacity:.88});
    var b2=new THREE.Mesh(g2,m2);
    b2.position.set(x,-2,.52);b2.userData.finalY=(hr/2)-2;b2.scale.y=.001;
    S.add(b2);bars.push({m:b2,delay:i*.12+.06});
  });
  // Grid
  var grid=new THREE.GridHelper(18,18,0x14532d,0x052e16);
  grid.position.y=-2;S.add(grid);
  // Luzes
  S.add(new THREE.AmbientLight(0xffffff,.3));
  var dl=new THREE.DirectionalLight(0x4ade80,.9);dl.position.set(5,9,6);S.add(dl);
  var dl2=new THREE.DirectionalLight(0x22d3ee,.35);dl2.position.set(-5,6,-4);S.add(dl2);
  var pl=new THREE.PointLight(0x4ade80,1.6,14);pl.position.set(0,5,0);S.add(pl);
  // Partículas
  var pg=new THREE.BufferGeometry();
  var pc=80,pp=new Float32Array(pc*3);
  for(var i=0;i<pc*3;i++)pp[i]=(Math.random()-.5)*15;
  pg.setAttribute('position',new THREE.BufferAttribute(pp,3));
  var pts=new THREE.Points(pg,new THREE.PointsMaterial({color:0x4ade80,size:.055,transparent:true,opacity:.38}));
  S.add(pts);
  var t=0,startTime=performance.now();
  function loop(){
    _dshRaf=requestAnimationFrame(loop);
    t=(performance.now()-startTime)/1000;
    // Câmera orbita
    CAM.position.x=Math.sin(t*.22)*2.2;
    CAM.position.z=9.5+Math.cos(t*.17)*1.6;
    CAM.position.y=3.8+Math.sin(t*.14)*.55;
    CAM.lookAt(0,0,0);
    // Barras sobem com delay
    bars.forEach(function(bd){
      var elapsed=t-bd.delay;
      if(elapsed>0&&bd.m.scale.y<1){
        var prog=Math.min(elapsed/1.2,1);
        var ease=1-Math.pow(1-prog,3);
        bd.m.scale.y=Math.max(ease,.001);
        bd.m.position.y=bd.m.userData.finalY-(bd.m.userData.finalY+2)*(1-ease);
      }
    });
    // Partículas sobem
    var pa=pts.geometry.attributes.position;
    for(var i=0;i<pc;i++){pa.array[i*3+1]+=.007;if(pa.array[i*3+1]>5)pa.array[i*3+1]=-4;}
    pa.needsUpdate=true;
    pl.intensity=1.4+Math.sin(t*1.8)*.4;
    R.render(S,CAM);
  }
  loop();
}

function renderDash(){
  if(!notas||!notas.length)return;
  document.getElementById('dash-card').style.display='block';
  var totalBruto=0,totalRepasse=0,countNFs=0,porMes={};
  notas.forEach(function(n){
    var mn=n.medicos_nota&&n.medicos_nota.find(function(m){return m.nome===comp.medico_nome;});
    if(!mn)return;
    countNFs++;
    var br=mn.valor_bruto_medico||0,ret=mn.retencao_individual||13;
    var rep=mn.repasse||(br*(1-ret/100));
    totalBruto+=br;totalRepasse+=rep;
    var mes=n.comp||'';
    if(mes){if(!porMes[mes])porMes[mes]={label:fmtMes(mes),bruto:0,repasse:0};porMes[mes].bruto+=br;porMes[mes].repasse+=rep;}
  });
  document.getElementById('dk-bruto').textContent='R$ '+brl(totalBruto);
  document.getElementById('dk-repasse').textContent='R$ '+brl(totalRepasse);
  document.getElementById('dk-nfs').textContent=countNFs;
  document.getElementById('dash-nome-med').textContent=comp.medico_nome||'—';
  var meses=Object.keys(porMes).sort().map(function(k){return porMes[k];});
  if(meses.length)document.getElementById('dash-periodo').textContent=
    meses.length===1?meses[0].label:(meses[0].label+' – '+meses[meses.length-1].label);
  // Barras horizontais
  var maxB=Math.max.apply(null,meses.map(function(m){return m.bruto;}).concat([1]));
  var delay=0;
  document.getElementById('dash-bars').innerHTML=meses.map(function(m,i){
    var pB=Math.max(Math.round((m.bruto/maxB)*100),4);
    var pR=Math.max(Math.round((m.repasse/maxB)*100),2);
    return '<div class="dsh-hrow" style="animation-delay:'+((i*.08)+.2)+'s"><div class="dsh-hlbl">'+m.label+'</div><div class="dsh-htrack"><div class="dsh-hfill" style="width:0" data-w="'+pB+'"></div><div class="dsh-hrep" style="width:0" data-w="'+pR+'"></div></div><div class="dsh-hval">R$'+brl(m.bruto)+'</div></div>';
  }).join('');
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    document.querySelectorAll('.dsh-hfill,.dsh-hrep').forEach(function(el){el.style.width=el.dataset.w+'%';});
  });});
  // Linha SVG animada
  var svg=document.getElementById('dash-lsvg');
  if(meses.length>=2){
    var W=240,H=82,PX=12,PY=10;
    var vals=meses.map(function(m){return m.repasse;});
    var minV=Math.min.apply(null,vals),maxV=Math.max.apply(null,vals),rng=maxV-minV||1;
    var xs=meses.map(function(_,i){return PX+i*((W-PX*2)/(meses.length-1));});
    var ys=vals.map(function(v){return PY+(1-(v-minV)/rng)*(H-PY*2);});
    var d='M'+xs[0]+','+ys[0];
    for(var i=1;i<xs.length;i++){var cx=(xs[i-1]+xs[i])/2;d+=' C'+cx+','+ys[i-1]+' '+cx+','+ys[i]+' '+xs[i]+','+ys[i];}
    var area=d+' L'+xs[xs.length-1]+','+H+' L'+xs[0]+','+H+' Z';
    svg.innerHTML='<defs><linearGradient id="dlg4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4ade80" stop-opacity=".28"/><stop offset="100%" stop-color="#4ade80" stop-opacity="0"/></linearGradient></defs>'
      +'<path d="'+area+'" fill="url(#dlg4)"/>'
      +'<path d="'+d+'" fill="none" stroke="rgba(74,222,128,.15)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'
      +'<path d="'+d+'" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2000" stroke-dashoffset="2000" style="animation:lineIn 1.4s .5s ease both forwards"/>'
      +xs.map(function(x,i){return '<circle cx="'+x+'" cy="'+ys[i]+'" r="0" fill="#020c06" stroke="#4ade80" stroke-width="2.5" style="cursor:pointer;animation:dotPop .4s '+(.5+i*.1)+'s ease both forwards" onmouseenter="dShowTip(event,\''+meses[i].label+'\',\'R$'+brl(meses[i].repasse)+'\')" onmouseleave="dHideTip()"/>';}).join('');
    document.getElementById('dash-xaxis').innerHTML=meses.map(function(m){return '<span>'+m.label+'</span>';}).join('');
  } else {
    svg.innerHTML='<text x="120" y="44" text-anchor="middle" font-size="11" fill="rgba(255,255,255,.2)">Apenas 1 mês</text>';
  }
  if(window.THREE)setTimeout(function(){initDsh3D(meses);},80);
}


function imprimirComp(){
  document.title=`AunordMED - Comprovante #${pad(numSeq)} - ${comp?.medico_nome||''}`;
  window.print();
  setTimeout(()=>{document.title='AunordMED — Comprovante de Repasse';},1000);
}

async function enviarWhatsApp(){
  const tel=medico?.telefone_whatsapp||medico?.telefone;
  if(!tel){toast('Médico sem WhatsApp cadastrado.','err');return;}
  const link=window.location.href;
  const msgPadrao=`🏥 *AunordMED Financeiro*\n\nOlá, Dr(a). *${comp.medico_nome}*!\n\nSeu comprovante de repasse *#${pad(numSeq)}* referente à competência *${fmtMes(comp.competencia)}* está disponível.\n\n💰 *Valor:* R$ ${brl(comp.valor_repasse)}\n📅 *Data:* ${fmtDt(comp.data_pagamento)}\n🏢 *Tomador:* ${comp.tomador||'—'}\n\n📄 Acesse seu comprovante:\n${link}\n\n_AunordMED — Gestão financeira médica_`;
  const msgEdit=prompt('Edite a mensagem antes de enviar:',msgPadrao);
  if(msgEdit===null)return;
  if(cfg.wppUrl&&cfg.wppKey){
    try{
      const r=await fetch(`${cfg.wppUrl}/message/sendText/${cfg.wppInst}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.wppKey},body:JSON.stringify({number:tel,text:msgEdit,delay:1000})});
      if(r.ok)toast('WhatsApp enviado!','wpp');
      else throw new Error();
    }catch{window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msgEdit)}`,'_blank');}
  }else{
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msgEdit)}`,'_blank');
    toast('Abrindo WhatsApp…','wpp');
  }
}

init();
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</body>
</html>

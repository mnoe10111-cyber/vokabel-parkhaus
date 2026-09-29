
let db, currentLessonId = null, study = null, deferredInstallPrompt = null;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $("#btnInstallApp")?.classList.remove("hidden");
});
window.addEventListener("appinstalled", () => $("#btnInstallApp")?.classList.add("hidden"));
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));

function req(r){ return new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function st(name,mode="readonly"){ return db.transaction(name,mode).objectStore(name); }

async function initDB(){
  db = await new Promise((res,rej)=>{
    const r=indexedDB.open("VokabelParkhausDB",1);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains("lessons")){
        const s=d.createObjectStore("lessons",{keyPath:"id",autoIncrement:true});
        s.createIndex("createdAt","createdAt");
      }
      if(!d.objectStoreNames.contains("vocab")){
        const s=d.createObjectStore("vocab",{keyPath:"id",autoIncrement:true});
        s.createIndex("lessonId","lessonId");
      }
    };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
async function lessons(){ return req(st("lessons").getAll()); }
async function lesson(id){ return req(st("lessons").get(id)); }
async function vocabs(id){ return req(st("vocab").index("lessonId").getAll(IDBKeyRange.only(id))); }
async function addLesson(name){ return req(st("lessons","readwrite").add({name:name.trim(),createdAt:Date.now()})); }
async function addVocab(foreign,german){
  return req(st("vocab","readwrite").add({lessonId:currentLessonId,foreign:foreign.trim(),german:german.trim(),correct:0,wrong:0,lastSeen:null}));
}
async function saveVocab(v){ return req(st("vocab","readwrite").put(v)); }
async function removeVocab(id){ return req(st("vocab","readwrite").delete(id)); }

async function removeLesson(id){
  const tx=db.transaction(["lessons","vocab"],"readwrite");
  tx.objectStore("lessons").delete(id);
  const c=tx.objectStore("vocab").index("lessonId").openCursor(IDBKeyRange.only(id));
  c.onsuccess=e=>{ const cur=e.target.result; if(cur){ cur.delete(); cur.continue(); } };
  await new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
}

function esc(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

async function renderLessons(){
  const a=(await lessons()).sort((x,y)=>x.createdAt-y.createdAt);
  $("#lessonList").innerHTML="";
  a.forEach(l=>{
    const b=document.createElement("button");
    b.className="lesson-btn"+(l.id===currentLessonId?" active":"");
    b.textContent="🅿️ "+l.name;
    b.onclick=()=>selectLesson(l.id);
    $("#lessonList").appendChild(b);
  });
}
async function selectLesson(id){
  currentLessonId=id;
  const l=await lesson(id);
  if(!l)return;
  $("#welcomeView").classList.add("hidden");
  $("#lessonView").classList.remove("hidden");
  $("#lessonTitle").textContent=l.name;
  await renderLessons(); await renderVocab();
}
async function renderVocab(){
  if(!currentLessonId)return;
  const a=(await vocabs(currentLessonId)).sort((x,y)=>x.foreign.localeCompare(y.foreign,"de"));
  const body=$("#vocabTableBody"); body.innerHTML="";
  a.forEach(v=>{
    const tries=v.correct+v.wrong;
    let label="neu", cls="";
    if(tries>=2){
      const q=v.correct/tries;
      if(q>=.75){label="sicher";cls="good";} else if(q<.5){label="unsicher";cls="weak";} else label="in Arbeit";
    }
    const tr=document.createElement("tr");
    tr.innerHTML="<td>"+esc(v.foreign)+"</td><td>"+esc(v.german)+"</td><td><span class='status-pill "+cls+"'>"+label+"</span></td><td><button class='delete-vocab' data-id='"+v.id+"'>🗑️</button></td>";
    body.appendChild(tr);
  });
  $("#emptyVocab").classList.toggle("hidden",a.length>0);
  $$(".delete-vocab").forEach(b=>b.onclick=async()=>{ await removeVocab(Number(b.dataset.id)); await renderVocab(); });
  const safe=a.filter(v=>v.correct+v.wrong>=2 && v.correct/(v.correct+v.wrong)>=.75).length;
  const weak=a.filter(v=>v.correct+v.wrong>0 && v.correct/(v.correct+v.wrong)<.5).length;
  $("#lessonStats").innerHTML="<div class='stat'><strong>"+a.length+"</strong><span>Vokabeln</span></div><div class='stat'><strong>"+safe+"</strong><span>sicher</span></div><div class='stat'><strong>"+weak+"</strong><span>unsicher</span></div>";
}

function tab(name){
  $$(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));
  $$(".tabpane").forEach(x=>x.classList.toggle("active",x.id==="tab-"+name));
}

function parseOCR(text){
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean), out=[];
  for(const line of lines){
    let p=line.split(/\s{2,}|\s*[;=]\s*|\s+[—–-]\s+/).map(x=>x.trim()).filter(Boolean);
    if(p.length>=2) out.push([p[0],p.slice(1).join(" / ")]);
  }
  if(!out.length) for(let i=0;i<lines.length-1;i+=2) out.push([lines[i],lines[i+1]||""]);
  return out;
}
function addOCRRow(a="",b=""){
  const d=document.createElement("div"); d.className="ocr-row";
  d.innerHTML="<input class='ocr-foreign' placeholder='Fremdsprache'><input class='ocr-german' placeholder='Deutsch'><button type='button'>✕</button>";
  d.children[0].value=a; d.children[1].value=b; d.children[2].onclick=()=>d.remove();
  $("#ocrRows").appendChild(d);
}
function showOCRRows(pairs){
  $("#ocrRows").innerHTML="";
  pairs.forEach(p=>addOCRRow(p[0],p[1]));
  $("#ocrReview").classList.remove("hidden");
}
async function runOCR(){
  const file=$("#photoInput").files[0];
  if(!file) return alert("Bitte zuerst ein Foto auswählen.");
  if(!window.Tesseract) return alert("Texterkennung konnte nicht geladen werden.");
  $("#btnRunOcr").disabled=true; $("#ocrStatus").textContent="Texterkennung läuft …";
  try{
    const r=await Tesseract.recognize(file,"eng+deu",{logger:m=>{ if(m.progress) $("#ocrStatus").textContent="Texterkennung: "+Math.round(m.progress*100)+" %"; }});
    $("#ocrText").value=r.data.text||"";
    showOCRRows(parseOCR($("#ocrText").value));
    $("#ocrStatus").textContent="Fertig. Bitte Einträge prüfen.";
  }catch(e){ console.error(e); alert("Texterkennung fehlgeschlagen."); }
  $("#btnRunOcr").disabled=false;
}

function norm(s){ return s.trim().toLocaleLowerCase("de").replace(/[.,!?;:()[\]"]/g,"").replace(/\s+/g," "); }
async function startStudy(){
  let a=await vocabs(currentLessonId);
  if(!a.length)return alert("Auf dieser Ebene sind noch keine Vokabeln.");
  if($("#studyPool").value==="weak"){
    const w=a.filter(v=>v.correct+v.wrong===0 || v.correct/(v.correct+v.wrong)<.75); if(w.length)a=w;
  }
  a.sort(()=>Math.random()-.5);
  study={items:a,i:0,answered:false};
  $("#studyLessonName").textContent=(await lesson(currentLessonId)).name;
  $("#studyDialog").showModal(); showCard();
}
function dir(){
  const d=$("#studyDirection").value;
  return d==="random"?(Math.random()<.5?"fg":"gf"):d==="foreignToGerman"?"fg":"gf";
}
function showCard(){
  if(study.i>=study.items.length){
    $("#studyPrompt").textContent="Ebene geschafft!";
    $("#studyAnswer").disabled=true; $("#btnCheckAnswer").disabled=true; $("#btnShowAnswer").disabled=true;
    $("#studyFeedback").textContent="Die Runde ist beendet.";
    $("#studyProgress").value=study.items.length; $("#studyProgressText").textContent=study.items.length+" / "+study.items.length; return;
  }
  study.d=dir(); study.answered=false;
  const v=study.items[study.i];
  $("#studyPrompt").textContent=study.d==="fg"?v.foreign:v.german;
  $("#studyAnswer").value=""; $("#studyAnswer").disabled=false;
  $("#btnCheckAnswer").disabled=false; $("#btnCheckAnswer").textContent="Prüfen"; $("#btnShowAnswer").disabled=false;
  $("#studyFeedback").textContent="";
  $("#studyProgress").max=study.items.length; $("#studyProgress").value=study.i; $("#studyProgressText").textContent=study.i+" / "+study.items.length;
  $("#studyAnswer").focus();
}
async function check(force=false){
  if(study.answered){ study.i++; showCard(); return; }
  const v=study.items[study.i], exp=study.d==="fg"?v.german:v.foreign, given=norm($("#studyAnswer").value);
  const ok=!force && exp.split(/[\/;,]/).map(norm).includes(given);
  if(ok){ v.correct++; $("#studyFeedback").textContent="Richtig."; $("#studyFeedback").className="feedback good"; }
  else { v.wrong++; $("#studyFeedback").textContent="Nicht ganz. Lösung: "+exp; $("#studyFeedback").className="feedback bad"; }
  v.lastSeen=Date.now(); await saveVocab(v); study.answered=true;
  $("#studyAnswer").disabled=true; $("#btnCheckAnswer").textContent="Weiter"; $("#btnShowAnswer").disabled=true; await renderVocab();
}

async function exportData(){
  const payload={app:"Vokabel-Parkhaus",version:1,lessons:await lessons(),vocab:await req(st("vocab").getAll())};
  const u=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  const a=document.createElement("a"); a.href=u; a.download="vokabel-parkhaus.json"; a.click(); URL.revokeObjectURL(u);
}
async function importData(file){
  const p=JSON.parse(await file.text()); if(!p.lessons||!p.vocab)throw Error("Format");
  const tx=db.transaction(["lessons","vocab"],"readwrite");
  tx.objectStore("lessons").clear(); tx.objectStore("vocab").clear();
  p.lessons.forEach(x=>tx.objectStore("lessons").put(x)); p.vocab.forEach(x=>tx.objectStore("vocab").put(x));
  await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
  currentLessonId=null; $("#lessonView").classList.add("hidden"); $("#welcomeView").classList.remove("hidden"); await renderLessons();
}

function events(){
  $("#btnInstallApp").onclick=async()=>{ if(deferredInstallPrompt){ deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt=null; } else alert("Nutze im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“."); };
  $("#btnNewLesson").onclick=()=>{ $("#newLessonName").value=""; $("#newLessonDialog").showModal(); };
  $("#newLessonForm").onsubmit=async e=>{ e.preventDefault(); const n=$("#newLessonName").value.trim(); if(!n)return; const id=await addLesson(n); $("#newLessonDialog").close(); await selectLesson(id); };
  $$(".tab").forEach(x=>x.onclick=()=>tab(x.dataset.tab));
  $("#manualForm").onsubmit=async e=>{ e.preventDefault(); const a=$("#foreignInput").value.trim(),b=$("#germanInput").value.trim(); if(a&&b){await addVocab(a,b); $("#foreignInput").value="";$("#germanInput").value="";await renderVocab();} };
  $("#photoInput").onchange=()=>{ const f=$("#photoInput").files[0]; if(f){$("#photoPreview").src=URL.createObjectURL(f);$("#previewWrap").classList.remove("hidden");} };
  $("#btnRunOcr").onclick=runOCR; $("#btnParseOcr").onclick=()=>showOCRRows(parseOCR($("#ocrText").value)); $("#btnAddOcrRow").onclick=()=>addOCRRow();
  $("#btnSaveOcr").onclick=async()=>{ let n=0; for(const r of $$("#ocrRows .ocr-row")){const a=r.children[0].value.trim(),b=r.children[1].value.trim();if(a&&b){await addVocab(a,b);n++;}} await renderVocab(); alert(n+" Vokabeln gespeichert."); tab("vocab"); };
  $("#btnDeleteLesson").onclick=async()=>{ const l=await lesson(currentLessonId); if(confirm("Ebene „"+l.name+"“ wirklich löschen?")){await removeLesson(currentLessonId);currentLessonId=null;$("#lessonView").classList.add("hidden");$("#welcomeView").classList.remove("hidden");await renderLessons();} };
  $("#btnStudy").onclick=startStudy; $("#btnCloseStudy").onclick=()=>$("#studyDialog").close(); $("#btnCheckAnswer").onclick=()=>check(false); $("#btnShowAnswer").onclick=()=>check(true);
  $("#studyAnswer").onkeydown=e=>{if(e.key==="Enter")check(false);};
  $("#studyDirection").onchange=()=>{if($("#studyDialog").open)startStudy();}; $("#studyPool").onchange=()=>{if($("#studyDialog").open)startStudy();};
  $("#btnExport").onclick=exportData; $("#btnImport").onclick=()=>$("#importDialog").showModal();
  $("#btnImportConfirm").onclick=async e=>{e.preventDefault();const f=$("#importFile").files[0];if(!f)return;try{await importData(f);$("#importDialog").close();}catch(_){alert("Import fehlgeschlagen.");}};
}

(async()=>{
  await initDB();
  if(!(await lessons()).length){ const id=await addLesson("Ebene 1 – Beispiel"); currentLessonId=id; await addVocab("house","Haus"); await addVocab("garden","Garten"); currentLessonId=null; }
  events(); await renderLessons();
})();

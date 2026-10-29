
const APP_VERSION='2.1.1'; // Verhoog dit nummer bij een nieuwe release
const TZ='Europe/Amsterdam';
const iso=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:TZ}).format(d);
const today=()=>iso(new Date());
const addDays=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const fmtDate=s=>new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'}).format(new Date(s+'T12:00:00Z'));
const num=s=>parseFloat(String(s).replace(',','.'));
const isN=s=>/^\d+([.,]\d+)?$/.test(s);
const fmt=n=>(Math.round(n*10)/10).toLocaleString('nl-NL',{maximumFractionDigits:1});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);

const BUILTIN={banaan:[89,1.1],kip:[110,23],kipfilet:[110,23],whey:[400,80],aardappelen:[77,2],aardappel:[77,2],spinazie:[23,2.9],'gemengd gehakt':[250,17],ei:[143,12.6],havermout:[370,13],rijst:[130,2.7]};
const DEF={s:{kcal:1900,prot:120,w:74.5,h:174,age:34,name:'Mijn Voeding'},days:{},lib:{}};
let st=JSON.parse(JSON.stringify(DEF)),date=today(),tab='today',msg='',errs=[];

// Opslag (IndexedDB)
const db=new Promise((res,rej)=>{try{const r=indexedDB.open('mijnvoeding',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}});
const idbGet=async k=>{const d=await db;return new Promise(r=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r()})};
const save=async()=>{try{const d=await db;d.transaction('kv','readwrite').objectStore('kv').put(JSON.parse(JSON.stringify(st)),'state')}catch(e){msg='Opslaan mislukt in deze browser.'}};

// Berekeningen
const day=(d=date)=>st.days[d]||{entries:[],ae:[],exercises:[]};
const wd=d=>st.days[d]||(st.days[d]={entries:[],ae:[],exercises:[]});
const exerciseKcalPerMinute={HIIT:9,'Krachttraining':5,'Krav Maga':9,'Wandelen':4,'Fietsen':7};
const exercisesOf=d=>d.exercises||(d.exercises=[]);
const sportTot=d=>exercisesOf(d).reduce((a,e)=>a+e.kcal,0);
const dayTot=d=>d.entries.reduce((a,e)=>({k:a.k+e.kcal,p:a.p+e.prot}),{k:0,p:0});
const ingTot=i=>({k:i.g*i.k/100,p:i.g*i.p/100});
const mealTot=d=>d.ae.reduce((a,i)=>{const t=ingTot(i);return{k:a.k+t.k,p:a.p+t.p}},{k:0,p:0});

function parseLine(raw){
  let l=raw.trim().replace(/\s+/g,' ');
  if(!l)return null;
  let m=l.match(/^(\d+(?:[.,]\d+)?)\s*(%|\/\s*(\d+(?:[.,]\d+)?))\s*ae$/i);
  if(m){
    const v=num(m[1]),f=m[2]==='%'?v/100:v/num(m[3]);
    if(!(f>0)||!isFinite(f))return{err:`Ongeldig aandeel: "${raw}"`};
    return{kind:'portion',f,label:l}
  }
  let ae=false;
  m=l.match(/^ae\s+(.+)$/i);
  if(m){ae=true;l=m[1]}
  const t=l.split(' ');
  if(t.every(isN)){
    if(ae)return{err:`ae vraagt om "gewicht product": "${raw}"`};
    if(t.length===3){
      const[g,k,p]=t.map(num);
      return{kind:'food',name:'Handmatig product',g,k,p,src:'user'}
    }
    if(t.length===2){
      const[k,p]=t.map(num);
      return{kind:'food',name:'Handmatig totaal',kcal:k,prot:p,total:true}
    }
    return{err:`Onduidelijk aantal getallen: "${raw}"`}
  }
  m=l.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|gram)?\s+(.+?)(?:\s+a\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?))?$/i);
  if(!m)return{err:`Niet herkend: "${raw}"`};
  const g=num(m[1]),name=m[2].trim();
  let k,p,src,est=false;
  if(m[3]){
    k=num(m[3]);p=num(m[4]);src='user'
  }else{
    const key=name.toLowerCase(),lb=st.lib[key];
    if(lb){k=lb.k;p=lb.p;src=lb.src;est=lb.est}
    else if(BUILTIN[key]){[k,p]=BUILTIN[key];src='ingebouwd (indicatief)';est=true}
    else return{err:`Onbekend product "${name}". Geef waarden per 100 g: "${g}g ${name} a <kcal> <eiwit>"`}
  }
  return{kind:ae?'ae':'food',name,g,k,p,src,est,fromUser:!!m[3]}
}

function addInput(text){
  const lines=text.split('\n'),items=[],errors=[];
  lines.forEach(l=>{const r=parseLine(l);if(!r)return;r.err?errors.push(r.err):items.push(r)});
  if(errors.length){errs=errors;return false}
  if(!items.length)return false;
  const d=wd(date);let ts=Date.now();
  for(const r of items){
    if(r.kind==='portion'){
      const mt=mealTot(d);
      if(mt.k<=0&&mt.p<=0){errs=['Er staat nog niets in de avondmaaltijd (ae).'];return false}
      d.entries.push({id:uid(),ts:ts++,type:'ae',name:'Avondmaaltijd '+r.label,f:r.f,mk:mt.k,mp:mt.p,kcal:mt.k*r.f,prot:mt.p*r.f})
    }else if(r.kind==='ae'){
      d.ae.push({id:uid(),name:r.name,g:r.g,k:r.k,p:r.p,est:r.est})
    }else if(r.total){
      d.entries.push({id:uid(),ts:ts++,type:'food',name:r.name,kcal:r.kcal,prot:r.prot})
    }else{
      d.entries.push({id:uid(),ts:ts++,type:'food',name:r.name,g:r.g,k:r.k,p:r.p,kcal:r.g*r.k/100,prot:r.g*r.p/100})
    }
    if(r.name&&r.k!=null&&r.name!=='Handmatig product'&&(r.fromUser||!st.lib[r.name.toLowerCase()]))
      st.lib[r.name.toLowerCase()]={name:r.name,k:r.k,p:r.p,src:r.fromUser?'door mij opgegeven':r.src,est:r.fromUser?false:!!r.est,fav:(st.lib[r.name.toLowerCase()]||{}).fav||false};
  }
  errs=[];save();return true;
}

// Dialoogvenster
function ask(title,fields,ok='Opslaan'){
  return new Promise(res=>{
    const o=document.createElement('div');o.className='ov';
    o.innerHTML=`<form class="card"><h2>${title}</h2>${fields.map((f,i)=>`<label>${f[0]}<input name="f${i}" value="${esc(f[1])}" ${f[2]?'':'inputmode="decimal"'}></label>`).join('')}<div class="row"><button type="button" class="c">Annuleer</button><button class="p">${ok}</button></div></form>`;
    document.body.appendChild(o);
    const f=o.querySelector('form'),first=f.querySelector('input');
    first&&first.focus();
    o.querySelector('.c').onclick=()=>{o.remove();res(null)};
    f.onsubmit=e=>{e.preventDefault();const v=fields.map((_,i)=>f['f'+i].value);o.remove();res(v)}
  })
}

// Voortgangsbalk
const bar=(lab,v,goal,unit,col)=>{
  const pct=Math.round(v/goal*100),r=goal-v;
  return `<div class="card"><div class="row sp"><h2>${lab}</h2><span class="mut">${pct}% van doel</span></div>
  <div class="big">${fmt(v)} <span class="mut">/ ${fmt(goal)} ${unit}</span></div>
  <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100,pct)}%;background:${r<0?'var(--over)':col}"></i></div>
  ${r<0?`<div class="over">${fmt(-r)} ${unit} boven doel</div>`:`<div class="mut">${fmt(r)} ${unit} resterend</div>`}</div>`
};

function vToday(){
  const d=day(),t=dayTot(d),mt=mealTot(d),has=d.ae.length>0,sp=sportTot(d),net=t.k-sp;
  return `<div class="row"><button class="i" data-a="prev" aria-label="Vorige dag">‹</button><div class="date">${fmtDate(date)}</div><button class="i" data-a="next" aria-label="Volgende dag">›</button></div>
  <div class="row" style="margin:8px 0 12px"><button data-a="today">Vandaag</button><button data-a="newday">Nieuwe dag</button></div>
  ${bar('Netto calorieën',net,st.s.kcal,'kcal','var(--kc)')}<div class="mut" style="text-align:center;margin:-4px 0 10px">Gegeten: ${fmt(t.k)} kcal − sport: ${fmt(sp)} kcal</div>${bar('Eiwitten',t.p,st.s.prot,'g','var(--pr)')}
  <div class="card"><h2>Toevoegen</h2><textarea id="in" placeholder="138 144 2&#10;450 54&#10;100g banaan&#10;125g sateschnitzel a 253 19,6&#10;ae 200g aardappelen&#10;50% ae" aria-label="Invoer"></textarea>
  ${errs.length?`<div class="err">${errs.map(esc).join('<br>')}<br>Er is niets opgeslagen.</div>`:''}
  <button class="p" data-a="add" style="width:100%;margin-top:8px">Toevoegen</button></div>
  <div class="card"><h2>Sport en verbranding</h2><div class="mut">Geschatte verbranding wordt van je calorieën afgetrokken. Eiwitten blijven gelijk.</div><button class="p" data-a="addsport" style="width:100%;margin-top:8px">Sport toevoegen</button>${exercisesOf(d).length?`<ul>${exercisesOf(d).map(e=>`<li class="e"><div>${esc(e.name)}<div class="mut">${fmt(e.minutes)} min · geschat</div></div><div style="text-align:right"><b>−${fmt(e.kcal)}</b> kcal</div><button class="i" data-a="delsport" data-id="${e.id}" aria-label="Sport verwijderen">✕</button></li>`).join('')}</ul><div class="mut">Totaal sport: −${fmt(sp)} kcal</div>`:'<div class="mut" style="margin-top:8px">Nog geen sport geregistreerd.</div>'}</div>
  ${has?`<div class="card"><h2>Avondmaaltijd (ae) · nog niet geteld</h2>
  <div class="big">${fmt(mt.k)} kcal · ${fmt(mt.p)} g eiwit</div>
  <ul>${d.ae.map(i=>{const x=ingTot(i);return `<li class="e"><div>${esc(i.name)}${i.est?' <span class="tag">(geschat)</span>':''}<div class="mut">${fmt(i.g)} g · ${fmt(x.k)} kcal · ${fmt(x.p)} g eiwit</div></div><button class="i" data-a="ied" data-id="${i.id}" aria-label="Aanpassen">✎</button><button class="i" data-a="idel" data-id="${i.id}" aria-label="Verwijderen">✕</button></li>`}).join('')}</ul>
  <div class="row" style="margin-top:8px">${[['25%',.25],['50%',.5],['100%',1]].map(p=>`<button data-a="portion" data-f="${p[1]}" data-l="${p[0]}">${p[0]} eten</button>`).join('')}</div>
  <button data-a="clearae" style="width:100%;margin-top:8px">Maaltijd leegmaken</button></div>`:''}
  <div class="card"><h2>Vandaag gegeten</h2>${d.entries.length?`<ul>${[...d.entries].sort((a,b)=>a.ts-b.ts).map(e=>`<li class="e"><div>${esc(e.name)}<div class="mut">${e.type==='ae'?fmt(e.f*100)+'% van '+fmt(e.mk)+' kcal':e.g!=null?fmt(e.g)+' g · '+fmt(e.k)+' kcal/100 g':'totaalwaarden'}</div></div><div style="text-align:right"><b>${fmt(e.kcal)}</b> kcal<div class="mut">${fmt(e.prot)} g</div></div><button class="i" data-a="ed" data-id="${e.id}" aria-label="Aanpassen">✎</button><button class="i" data-a="del" data-id="${e.id}" aria-label="Verwijderen">✕</button></li>`).join('')}</ul>`:'<div class="mut">Nog niets ingevoerd voor deze dag.</div>'}</div>`
}

function vHist(){
  const ds=Object.keys(st.days).filter(k=>st.days[k].entries.length).sort().reverse();
  const rows=ds.map(k=>{const d=st.days[k],raw=dayTot(d),t={k:raw.k-sportTot(d),p:raw.p};return{k,t,pk:Math.round(t.k/st.s.kcal*100),pp:Math.round(t.p/st.s.prot*100)}});
  const w=[];
  for(let i=6;i>=0;i--){
    const k=addDays(today(),-i),d=day(k),raw=dayTot(d);
    w.push({k:raw.k-sportTot(d),p:raw.p})
  }
  const act=w.filter(x=>x.k>0),n=act.length||1,ak=act.reduce((a,x)=>a+x.k,0)/n,ap=act.reduce((a,x)=>a+x.p,0)/n;
  const ch=[];
  for(let i=13;i>=0;i--){
    const k=addDays(today(),-i),d=day(k),raw=dayTot(d),net=raw.k-sportTot(d);
    ch.push(`<i title="${k}" style="height:${Math.max(0,Math.min(100,net/st.s.kcal*100))}%${net>st.s.kcal?';background:var(--over)':''}"></i>`)
  }
  return `<h1>Geschiedenis</h1><div class="card"><h2>Laatste 7 dagen (${act.length} dagen met invoer)</h2>
  <div>Gemiddeld <b>${fmt(ak)} kcal</b> (${Math.round(ak/st.s.kcal*100)}%) · <b>${fmt(ap)} g eiwit</b> (${Math.round(ap/st.s.prot*100)}%)</div>
  <div class="ch" aria-label="Kcal per dag, laatste 14 dagen">${ch.join('')}</div><div class="mut">kcal t.o.v. doel, laatste 14 dagen</div></div>
  <div class="card">${rows.length?`<ul>${rows.map(r=>`<li class="e"><button style="flex:1;text-align:left;border:0;background:none" data-a="goto" data-d="${r.k}"><b style="text-transform:capitalize">${fmtDate(r.k)}</b><div class="mut">${fmt(r.t.k)} kcal (${r.pk}%) · ${fmt(r.t.p)} g eiwit (${r.pp}%)</div></button></li>`).join('')}</ul>`:'<div class="mut">Nog geen dagen geregistreerd.</div>'}</div>`
}

function vFood(){
  const l=Object.entries(st.lib).sort((a,b)=>(b[1].fav-a[1].fav)||a[0].localeCompare(b[0]));
  return `<h1>Voedingsmiddelen</h1><div class="card">${l.length?`<ul>${l.map(([k,f])=>`<li class="e"><div>${esc(f.name)}${f.est?' <span class="tag">(geschat)</span>':''}<div class="mut">${fmt(f.k)} kcal · ${fmt(f.p)} g eiwit per 100 g · ${esc(f.src||'')}</div></div><button class="i fav" data-a="fav" data-k="${esc(k)}" aria-label="Favoriet">${f.fav?'★':'☆'}</button><button data-a="use" data-k="${esc(k)}">Voeg toe</button><button class="i" data-a="libdel" data-k="${esc(k)}" aria-label="Verwijderen">✕</button></li>`).join('')}</ul>`:'<div class="mut">Producten die je invoert met waarden per 100 g of die herkend worden, verschijnen hier.</div>'}</div>`
}

function vSet(){
  const s=st.s;
  const f=(k,l,t)=>`<label>${l}<input data-s="${k}" value="${esc(s[k])}" ${t?'':'inputmode="decimal"'}></label>`;
  return `<h1>Instellingen</h1><div class="card">${f('kcal','Dagelijks kcal-doel')}${f('prot','Dagelijks eiwitdoel (g)')}${f('w','Gewicht (kg)')}${f('h','Lengte (cm)')}${f('age','Leeftijd')}${f('name','Naam van de app',1)}
  <button class="p" data-a="savesets" style="width:100%">Opslaan</button>${msg?`<div class="mut" style="margin-top:8px">${esc(msg)}</div>`:''}</div>
  <div class="card"><h2>Gegevens</h2><button data-a="export" style="width:100%;margin-bottom:8px">Exporteer back-up (JSON)</button><button data-a="import" style="width:100%;margin-bottom:8px">Importeer back-up</button><button data-a="wipe" style="width:100%;color:var(--over)">Alle gegevens verwijderen</button></div>
  <div class="card app-info"><h2>Over deze app</h2><div class="mut">Versie <strong>${APP_VERSION}</strong></div></div>`
}

function render(){
  document.title=st.s.name;
  document.getElementById('app').innerHTML=(tab==='today'?`<h1>${esc(st.s.name)}</h1>`:'')+({today:vToday,hist:vHist,food:vFood,set:vSet}[tab])();
  document.getElementById('nav').innerHTML=[['today','Vandaag'],['hist','Geschiedenis'],['food','Voeding'],['set','Instellingen']].map(t=>`<button data-a="tab" data-t="${t[0]}" class="${tab===t[0]?'on':''}">${t[1]}</button>`).join('')
}

const done=()=>{save();render()};

async function showText(title,text,ro){
  return new Promise(res=>{
    const o=document.createElement('div');o.className='ov';
    o.innerHTML=`<form class="card"><h2>${title}</h2><textarea style="min-height:200px" ${ro?'readonly':''}>${esc(text)}</textarea><div class="row" style="margin-top:8px"><button type="button" class="c">Sluiten</button>${ro?'<button type="button" class="p k">Kopieer</button>':'<button class="p">Importeer</button>'}</div></form>`;
    document.body.appendChild(o);
    const ta=o.querySelector('textarea');
    o.querySelector('.c').onclick=()=>{o.remove();res(null)};
    if(ro){
      ta.select();
      o.querySelector('.k').onclick=async()=>{ta.select();try{await navigator.clipboard.writeText(text)}catch(e){document.execCommand('copy')}}
    }
    o.querySelector('form').onsubmit=e=>{e.preventDefault();o.remove();res(ta.value)}
  })
}

document.addEventListener('click',async ev=>{
  const b=ev.target.closest('[data-a]');
  if(!b)return;
  const a=b.dataset.a;

  if(a==='tab'){tab=b.dataset.t;msg='';return render()}
  if(a==='prev'){date=addDays(date,-1);errs=[];return render()}
  if(a==='next'){date=addDays(date,1);errs=[];return render()}
  if(a==='today'){date=today();errs=[];return render()}
  if(a==='newday'){
    const ks=Object.keys(st.days).filter(k=>st.days[k].entries.length||st.days[k].ae.length).sort();
    const last=ks.length?ks[ks.length-1]:null;
    date=last&&last>=today()?addDays(last,1):today();errs=[];return render()
  }
  if(a==='goto'){date=b.dataset.d;tab='today';return render()}
  if(a==='add'){const ta=document.getElementById('in');if(addInput(ta.value))ta.value='';return render()}
  if(a==='portion'){addInput(b.dataset.l.replace('%','% ae'));return render()}

  if(a==='addsport'){
    const v=await ask('Sport toevoegen',[
      ['Activiteit (HIIT, Krachttraining, Krav Maga, Wandelen of Fietsen)','HIIT',1],
      ['Duur in minuten','20']
    ],'Toevoegen');
    if(!v)return;
    const name=v[0].trim(),minutes=num(v[1]);
    const key=Object.keys(exerciseKcalPerMinute).find(k=>k.toLowerCase()===name.toLowerCase());
    if(!key||!(minutes>0)||!isFinite(minutes)){
      msg='Kies een bekende activiteit en vul een duur groter dan 0 in.';
      return render()
    }
    const kcal=Math.round(minutes*exerciseKcalPerMinute[key]);
    exercisesOf(wd(date)).push({id:uid(),name:key,minutes,kcal});
    msg='Sport toegevoegd (verbranding is een schatting).';
    return done()
  }

  if(a==='delsport'){
    const w=wd(date);
    w.exercises=exercisesOf(w).filter(e=>e.id!==b.dataset.id);
    return done()
  }

  if(a==='del'){
    const w=wd(date);
    w.entries=w.entries.filter(e=>e.id!==b.dataset.id);
    return done()
  }

  if(a==='idel'){
    const w=wd(date);
    w.ae=w.ae.filter(e=>e.id!==b.dataset.id);
    return done()
  }

  if(a==='clearae'){wd(date).ae=[];return done()}

  if(a==='ed'){
    const e=wd(date).entries.find(x=>x.id===b.dataset.id);
    let v;
    if(e.type==='ae'){
      v=await ask('Portie aanpassen',[['Percentage van de maaltijd',fmt(e.f*100)]]);
      if(!v)return;
      const f=num(v[0])/100;
      if(!(f>0))return;
      e.f=f;e.kcal=e.mk*f;e.prot=e.mp*f;e.name='Avondmaaltijd '+fmt(f*100)+'% ae'
    }else if(e.g!=null){
      v=await ask('Aanpassen',[['Naam',e.name,1],['Gewicht (g)',fmt(e.g)],['kcal per 100 g',fmt(e.k)],['Eiwit per 100 g',fmt(e.p)]]);
      if(!v)return;
      const [n,g,k,p]=[v[0],num(v[1]),num(v[2]),num(v[3])];
      if([g,k,p].some(x=>!isFinite(x)||x<0))return;
      Object.assign(e,{name:n,g,k,p,kcal:g*k/100,prot:g*p/100})
    }else{
      v=await ask('Aanpassen',[['Totaal kcal',fmt(e.kcal)],['Totaal eiwit (g)',fmt(e.prot)]]);
      if(!v)return;
      const k=num(v[0]),p=num(v[1]);
      if(![k,p].every(x=>isFinite(x)&&x>=0))return;
      e.kcal=k;e.prot=p
    }
    return done()
  }

  if(a==='ied'){
    const i=wd(date).ae.find(x=>x.id===b.dataset.id);
    const v=await ask('Ingrediënt aanpassen',[['Naam',i.name,1],['Gewicht (g)',fmt(i.g)],['kcal per 100 g',fmt(i.k)],['Eiwit per 100 g',fmt(i.p)]]);
    if(!v)return;
    const g=num(v[1]),k=num(v[2]),p=num(v[3]);
    if([g,k,p].some(x=>!isFinite(x)||x<0))return;
    Object.assign(i,{name:v[0],g,k,p});
    return done()
  }

  if(a==='fav'){const f=st.lib[b.dataset.k];f.fav=!f.fav;return done()}
  if(a==='libdel'){delete st.lib[b.dataset.k];return done()}

  if(a==='use'){
    const f=st.lib[b.dataset.k],v=await ask('Hoeveelheid '+esc(f.name),[['Gewicht (g)','100']],'Toevoegen');
    if(!v||!(num(v[0])>0))return;
    const g=num(v[0]);
    wd(date).entries.push({id:uid(),ts:Date.now(),type:'food',name:f.name,g,k:f.k,p:f.p,kcal:g*f.k/100,prot:g*f.p/100});
    tab='today';
    return done()
  }

  if(a==='savesets'){
    const o={};let ok=true;
    document.querySelectorAll('[data-s]').forEach(i=>{
      const k=i.dataset.s;
      if(k==='name')o[k]=i.value.trim()||'Mijn Voeding';
      else{
        const n=num(i.value);
        if(!(n>0))ok=false;
        o[k]=n
      }
    });
    if(!ok){msg='Vul overal een getal groter dan 0 in.';return render()}
    Object.assign(st.s,o);
    msg='Opgeslagen.';
    return done()
  }

  if(a==='export')return showText('Back-up: kopieer en bewaar deze tekst',JSON.stringify({app:'mijn-voeding',v:1,data:st},null,1),true);

  if(a==='import'){
    const t=await showText('Plak je back-up (JSON) en importeer','',false);
    if(!t)return;
    try{
      const j=JSON.parse(t),x=j.data||j;
      if(!x.s||!x.days||!x.lib)throw 0;
      st=x;msg='Back-up teruggezet.';
      return done()
    }catch(e){
      msg='Ongeldige back-up: niets gewijzigd.';
      return render()
    }
  }

  if(a==='wipe'){
    const v=await ask('Alles verwijderen?',[['Typ VERWIJDER om te bevestigen','',1]],'Verwijder');
    if(v&&v[0].trim().toUpperCase()==='VERWIJDER'){
      st=JSON.parse(JSON.stringify(DEF));
      msg='Alle gegevens zijn verwijderd.';
      return done()
    }
  }
});

(async()=>{
  try{
    const s=await idbGet('state');
    if(s&&s.s)st=s
  }catch(e){}
  render()
})();

// ==UserScript==
// @name         Wanda — Lalabella Order Agent
// @namespace    lalabella-wanda
// @version      0.2.0
// @description  Monitors Lalabella unassigned orders and sends live observations to the local Wanda Command Center. Assignment remains disarmed.
// @match        https://lalabella.web.app/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
    'use strict';

    if (window.__LALABELLA_WANDA_ORDER_AGENT__) return;
    window.__LALABELLA_WANDA_ORDER_AGENT__ = true;

    const API = 'http://127.0.0.1:8787';
    const POLL_MS = 2500;
    const GEOCODE_DELAY_MS = 1100;

    const BRANCHES = [
        { name:'Moda Mall', lat:26.238635, lon:50.582121, keywords:['Seef','Manama','Sitra','Manama Center','Diplomatic Area','Hoora','Gudaibiya','Juffair','Seef District','Reef Island','Bahrain Financial Harbour','Adliya','Mahooz','Umm Al Hassam','Bu Ashira','Al Suqayyah','Al Salmaniya','Al Burhama','Al Naim','Sanabis','Kerbabad','Zinj','Bilad Al Qadeem','Jurdab','Sanad','Bahrain Bay'] },
        { name:'Qalali', lat:26.270309, lon:50.661218, keywords:['Muharraq','Amwaj','Galali','Amwaj Islands','Diyar Al Muharraq','Busaiteen','Hidd','Arad','Al Muharraq Center','Al Dair','Samaheej','Halat Bu Maher','Halat Al Naim','Halat Al Sulta'] },
        { name:'Hamala', lat:26.14409, lon:50.48298, keywords:['Riffa','Budaiya','Saar','Duraz','Hamala','Bani Jamra','Jasra','Karzakan','Hamad Town','Zayed Town','Zallaq','Buri','Dumistan','Shahrakan','Al Malikiyah','Sadad','Isa Town','Janabiya','Karbabad'] }
    ];

    const state = {
        lastOrderId:'',
        lastAddress:'',
        lastSentKey:'',
        teach:false,
        clicks:[],
        log:[]
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const norm = value => String(value || '').toLowerCase().replace(/\s+/g,' ').trim();

    function log(message) {
        const time = new Date().toLocaleTimeString();
        state.log.push(`[${time}] ${message}`);
        if (state.log.length > 100) state.log.shift();
        console.log(`[WANDA ORDER AGENT] ${message}`);
        renderLog();
    }

    function request(path, method, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url: API + path,
                headers: { 'Content-Type':'application/json' },
                data: body ? JSON.stringify(body) : undefined,
                timeout: 5000,
                onload: response => {
                    if (response.status >= 200 && response.status < 300) {
                        try { resolve(JSON.parse(response.responseText || '{}')); }
                        catch (_) { resolve({ ok:true }); }
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: () => reject(new Error('Connection failed')),
                ontimeout: () => reject(new Error('Request timeout'))
            });
        });
    }

    async function publishAgentStatus(online) {
        try {
            await request('/orders/agent', 'POST', {
                agent:'wanda-order-agent',
                online
            });
        } catch (_) {
            // Command Center may not be running yet.
        }
    }

    async function publishOrder(order, decision) {
        try {
            await request('/orders/event', 'POST', {
                agent:'wanda-order-agent',
                order:{
                    orderId:order.orderId,
                    address:order.address,
                    decision
                }
            });

            state.lastSentKey = `${order.orderId}|${order.address}|${decision?.branch || ''}`;
            log(`Published ${order.orderId} to Wanda Command Center.`);
        } catch (error) {
            log(`Command Center bridge unavailable: ${error.message}`);
        }
    }

    function enableAccessibility() {
        document.querySelectorAll('flt-semantics-placeholder').forEach(el => {
            try { el.style.pointerEvents = 'auto'; } catch (_) {}
        });
    }

    function scanOrder() {
        const text = document.body?.innerText || '';
        if (!text) return null;

        const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
        let orderId = '';
        let address = '';

        for (let i=0; i<lines.length; i++) {
            if (/unassigned/i.test(lines[i])) {
                for (let j=i; j<Math.min(lines.length, i+35); j++) {
                    const match = lines[j].match(/#\d{3,7}/);
                    if (match) {
                        orderId = match[0];
                        address = lines[j+1] || '';
                        break;
                    }
                }
            }
            if (orderId) break;
        }

        if (!orderId) {
            const match = text.match(/#\d{3,7}/);
            if (!match) return null;
            orderId = match[0];
            const index = lines.findIndex(x => x.includes(orderId));
            address = index >= 0 ? (lines[index+1] || '') : '';
        }

        return { orderId, address, rawText:text };
    }

    function keywordMatches(address) {
        const a = norm(address);
        const matches = [];
        BRANCHES.forEach(branch => {
            branch.keywords.forEach(keyword => {
                if (a.includes(norm(keyword))) {
                    matches.push({ branch:branch.name, keyword });
                }
            });
        });
        return matches;
    }

    function haversine(aLat,aLon,bLat,bLon) {
        const R=6371;
        const dLat=(bLat-aLat)*Math.PI/180;
        const dLon=(bLon-aLon)*Math.PI/180;
        const x=Math.sin(dLat/2)**2+
            Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*Math.sin(dLon/2)**2;
        return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
    }

    async function geocode(address) {
        if (!address) return null;
        try {
            const url='https://nominatim.openstreetmap.org/search?'+new URLSearchParams({
                q:address+', Bahrain', format:'json', limit:'1'
            });
            const response=await fetch(url,{headers:{Accept:'application/json'}});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data=await response.json();
            if (!data.length) return null;
            return {lat:Number(data[0].lat),lon:Number(data[0].lon)};
        } catch (error) {
            log(`Geocode failed: ${error.message}`);
            return null;
        }
    }

    async function decideBranch(address) {
        const matches=keywordMatches(address);
        const branches=[...new Set(matches.map(x=>x.branch))];

        if (branches.length===1) {
            return {branch:branches[0],method:'keyword',confidence:'high',matches};
        }

        if (branches.length>1) {
            log(`Ambiguous address keywords: ${branches.join(', ')}`);
        }

        if (!address) {
            return {branch:null,method:'none',confidence:'low',matches};
        }

        await sleep(GEOCODE_DELAY_MS);
        const point=await geocode(address);
        if (!point) {
            return {branch:null,method:'unresolved',confidence:'low',matches};
        }

        const distances=BRANCHES.map(branch=>({
            branch:branch.name,
            distanceKm:haversine(point.lat,point.lon,branch.lat,branch.lon)
        })).sort((a,b)=>a.distanceKm-b.distanceKm);

        return {
            branch:distances[0].branch,
            method:'geocode',
            confidence:'medium',
            distanceKm:distances[0].distanceKm,
            matches
        };
    }

    async function processOrder(order) {
        const decision=await decideBranch(order.address);
        const key=`${order.orderId}|${order.address}|${decision.branch || ''}`;

        if (key===state.lastSentKey) return;

        state.lastOrderId=order.orderId;
        state.lastAddress=order.address || '';

        log(`Detected ${order.orderId} · ${order.address || 'no address'}`);
        log(decision.branch
            ? `Recommended ${decision.branch} (${decision.method}, ${decision.confidence})`
            : 'Needs Review — branch unresolved.'
        );

        await publishOrder(order,decision);
        renderOrder(order,decision);
    }

    function startTeach() {
        if (state.teach) return;
        state.teach=true;
        document.addEventListener('click',teachClick,true);
        log('Teach Mode started. Perform ONE real manual assignment.');
        updateTeachButton();
    }

    function stopTeach() {
        if (!state.teach) return;
        state.teach=false;
        document.removeEventListener('click',teachClick,true);
        log('Teach Mode stopped.');
        updateTeachButton();
    }

    function label(el) {
        return el?.getAttribute?.('aria-label') || el?.innerText || el?.textContent || el?.tagName || '';
    }

    function path(el) {
        const parts=[];
        let cur=el;
        for(let i=0;cur && i<7;i++,cur=cur.parentElement){
            let p=cur.tagName.toLowerCase();
            if(cur.id)p+=`#${cur.id}`;
            parts.unshift(p);
        }
        return parts.join(' > ');
    }

    function teachClick(event) {
        if (!state.teach) return;
        const el=event.target?.closest?.('button,[role="button"],[role="option"],[role="menuitem"],li,a,flt-semantics,flt-semantics-placeholder') || event.target;
        const record={time:new Date().toISOString(),label:String(label(el)).replace(/\s+/g,' ').trim(),path:path(el)};
        state.clicks.push(record);
        if(state.clicks.length>100)state.clicks.shift();
        log(`TEACH CLICK #${state.clicks.length}: ${record.label}`);
        renderClicks();
    }

    function updateTeachButton(){
        const b=document.getElementById('wanda-agent-teach');
        if(b)b.textContent=state.teach?'⛔ Stop Teach Mode':'🎓 Start Teach Mode';
    }

    function renderOrder(order,decision){
        const el=document.getElementById('wanda-agent-order');
        if(!el)return;
        el.innerHTML=`<b>${escapeHtml(order.orderId)}</b><br>${escapeHtml(order.address||'Address not detected')}<div class="wa-branch">📍 ${escapeHtml(decision.branch||'NEEDS REVIEW')}</div><small>${escapeHtml(decision.method)} · ${escapeHtml(decision.confidence)}</small>`;
    }

    function renderClicks(){
        const el=document.getElementById('wanda-agent-clicks');
        if(!el)return;
        el.textContent=state.clicks.slice(-20).map((x,i)=>`#${i+1} ${x.label}\n${x.path}`).join('\n\n') || 'No clicks recorded.';
    }

    function renderLog(){
        const el=document.getElementById('wanda-agent-log');
        if(el)el.textContent=state.log.slice(-50).reverse().join('\n');
    }

    function escapeHtml(value){
        const d=document.createElement('div');
        d.textContent=String(value||'');
        return d.innerHTML;
    }

    function createPanel(){
        if(document.getElementById('wanda-agent-panel'))return;

        const css=document.createElement('style');
        css.textContent=`
        #wanda-agent-panel{position:fixed;top:18px;right:18px;width:350px;max-height:80vh;z-index:2147483647;background:#120d18;color:#f7edf8;border:1px solid #6d4a82;border-radius:15px;box-shadow:0 18px 50px rgba(0,0,0,.45);font:12px/1.4 Segoe UI,Arial,sans-serif;overflow:hidden}
        #wanda-agent-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:linear-gradient(135deg,#3b1f5d,#21162e);cursor:move;user-select:none}
        #wanda-agent-title{font-weight:900;color:#d8c5ff}#wanda-agent-sub{font-size:9px;opacity:.55}
        #wanda-agent-buttons{display:flex;gap:5px}#wanda-agent-buttons button{width:27px;height:27px;border:0;border-radius:7px;background:#ffffff18;color:#fff;cursor:pointer}
        #wanda-agent-body{padding:11px;max-height:calc(80vh - 49px);overflow:auto}.wa-card{border:1px solid #33253d;background:#1d1724;border-radius:11px;padding:9px;margin-bottom:8px}.wa-label{font-size:8px;letter-spacing:.1em;opacity:.5;text-transform:uppercase}.wa-value{margin-top:4px;font-size:11px;word-break:break-word}.wa-branch{margin-top:7px;padding:7px;border-radius:8px;background:#271c35;font-weight:800;color:#d9c6ff}.wa-btns{display:grid;grid-template-columns:1fr 1fr;gap:6px}.wa-btn{border:0;border-radius:8px;padding:8px;background:#4b3263;color:#fff;font-weight:800;cursor:pointer}.wa-btn.primary{background:#7c4ac1}.wa-btn.danger{background:#542630}.wa-pre{max-height:130px;overflow:auto;white-space:pre-wrap;font:9px Consolas,monospace;opacity:.75}.wa-live{color:#7df0b1}.wa-muted{opacity:.5}
        `;
        document.head.appendChild(css);

        const p=document.createElement('div');
        p.id='wanda-agent-panel';
        p.innerHTML=`
        <div id="wanda-agent-header"><div><div id="wanda-agent-title">🟣 WANDA ORDER AGENT</div><div id="wanda-agent-sub">Command Center bridge · v0.2.0</div></div><div id="wanda-agent-buttons"><button id="wanda-agent-min">−</button><button id="wanda-agent-close">×</button></div></div>
        <div id="wanda-agent-body">
        <div class="wa-card"><div class="wa-label">Status</div><div class="wa-value wa-live">● Monitoring Lalabella Web</div><div class="wa-muted">Automation DISARMED</div></div>
        <div class="wa-card"><div class="wa-label">Current Order</div><div id="wanda-agent-order" class="wa-value">No unassigned order detected.</div></div>
        <div class="wa-card"><div class="wa-label">Teach Wanda</div><div class="wa-muted">Record one real manual assignment for the next automation stage.</div><div class="wa-btns"><button id="wanda-agent-teach" class="wa-btn primary">🎓 Start Teach Mode</button><button id="wanda-agent-scan" class="wa-btn">🔎 Scan Now</button></div></div>
        <div class="wa-card"><div class="wa-label">Recorded Clicks</div><pre id="wanda-agent-clicks" class="wa-pre">No clicks recorded.</pre></div>
        <div class="wa-card"><div class="wa-label">Agent Log</div><pre id="wanda-agent-log" class="wa-pre"></pre></div>
        </div>`;
        document.body.appendChild(p);

        document.getElementById('wanda-agent-close').onclick=()=>p.style.display='none';
        document.getElementById('wanda-agent-min').onclick=()=>{
            const body=document.getElementById('wanda-agent-body');
            const min=document.getElementById('wanda-agent-min');
            const hidden=body.style.display==='none';
            body.style.display=hidden?'':'none';
            p.style.width=hidden?'350px':'145px';
            min.textContent=hidden?'−':'+';
        };
        document.getElementById('wanda-agent-teach').onclick=()=>state.teach?stopTeach():startTeach();
        document.getElementById('wanda-agent-scan').onclick=()=>check();

        let drag=false,ox=0,oy=0;
        document.getElementById('wanda-agent-header').addEventListener('mousedown',e=>{
            if(e.target.closest('button'))return;
            drag=true;
            const r=p.getBoundingClientRect();
            ox=e.clientX-r.left;oy=e.clientY-r.top;
            p.style.left=r.left+'px';p.style.top=r.top+'px';p.style.right='auto';
            document.body.style.userSelect='none';
        });
        document.addEventListener('mousemove',e=>{
            if(!drag)return;
            const x=Math.max(0,Math.min(window.innerWidth-p.offsetWidth,e.clientX-ox));
            const y=Math.max(0,Math.min(window.innerHeight-p.offsetHeight,e.clientY-oy));
            p.style.left=x+'px';p.style.top=y+'px';
        });
        document.addEventListener('mouseup',()=>{drag=false;document.body.style.userSelect='';});
    }

    async function check(){
        enableAccessibility();
        const order=scanOrder();
        if(!order)return;
        if(order.orderId===state.lastOrderId && order.address===state.lastAddress)return;
        await processOrder(order);
    }

    function start(){
        createPanel();
        log('Order Agent started. Automation is DISARMED.');
        publishAgentStatus(true);
        check();
        setInterval(check,POLL_MS);
    }

    window.addEventListener('beforeunload',()=>publishAgentStatus(false));

    if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded',start);
    }else{
        start();
    }
})();

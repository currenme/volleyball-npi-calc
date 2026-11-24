"use strict";

// Coefficients from results/win_probability_2024_2025/model_coefficients.csv
// pooled,S3_monotone_saturating. No backend or external library is required.
const MODEL = Object.freeze({a: 4.412233416767876, scale: 15.72371778530277});

function winProbability(ours, opponent) {
  const difference = ours - opponent;
  const z = Math.sign(difference) * MODEL.a * (-Math.expm1(-Math.abs(difference) / MODEL.scale));
  return 1 / (1 + Math.exp(-z));
}

const $ = id => document.getElementById(id);
const ourInput = $("our-npi");
const oppInput = $("opp-npi");
const inputSources = {ours: "Manual input", opp: "Manual input"};
let archive = null;
let selectedRating = null;

function calculate() {
  const a = ourInput.valueAsNumber;
  const b = oppInput.valueAsNumber;
  $("our-source").textContent = inputSources.ours;
  $("opp-source").textContent = inputSources.opp;
  const warning = $("prediction-warning");
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
    $("our-prob").textContent = $("opp-prob").textContent = "—";
    $("prob-fill").style.width = "50%";
    $("match-detail").textContent = "Enter two valid, nonnegative NPI values.";
    warning.hidden = true;
    return;
  }
  const gap = Math.abs(a-b);
  const p = winProbability(a,b);
  $("our-prob").textContent = (p*100).toFixed(1) + "%";
  $("opp-prob").textContent = ((1-p)*100).toFixed(1) + "%";
  $("prob-fill").style.width = (100*p) + "%";
  $("match-detail").textContent = "NPI difference: " + gap.toFixed(2) +
    " points · " + (a===b ? "Equal ratings" : a>b ? "Your team is favored" : "Opponent is favored");
  const cautions = [];
  if (gap >= 20) cautions.push("Large NPI differences are less well represented in the training data; treat this estimate cautiously.");
  if (a>100 || b>100) cautions.push("This rating is outside the usual NPI range; the estimate may be extrapolating.");
  if (inputSources.ours !== "Manual input" || inputSources.opp !== "Manual input") {
    cautions.push("At least one input is a historical rating, not a current rating.");
  }
  warning.hidden = !cautions.length;
  warning.textContent = cautions.join(" ");
}

for (const [input,key] of [[ourInput,"ours"],[oppInput,"opp"]]) {
  input.addEventListener("input", () => {
    inputSources[key] = "Manual input";
    calculate();
  });
}
$("swap").addEventListener("click", () => {
  [ourInput.value,oppInput.value] = [oppInput.value,ourInput.value];
  [inputSources.ours,inputSources.opp] = [inputSources.opp,inputSources.ours];
  calculate();
});

function searchKey(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/&/g," and ").replace(/[^a-z0-9]/g,"");
}

function teamSearchText(team) {
  // Common abbreviations used in NCAA records are retained as search aliases.
  return [team.name, team.key, ...(team.aliases || [])].map(searchKey);
}

function seasonData() {
  return archive.seasons[$("season").value];
}

function updateTeamList(preferred) {
  const season = seasonData();
  const query = searchKey($("team-search").value);
  const matches = season.teams.filter(t => teamSearchText(t).some(a => a.includes(query)));
  const select = $("team");
  const previous = preferred || select.value;
  select.replaceChildren();
  for (const team of matches) {
    const option = document.createElement("option");
    option.value = team.key;
    option.textContent = team.name + (team.ratings ? "" : " — unavailable");
    select.appendChild(option);
  }
  if (matches.some(t => t.key===previous)) select.value = previous;
  else if (query && matches.length) select.value = matches[0].key;
  else if (matches.some(t=>t.key==="mit")) select.value="mit";
  select.disabled = matches.length===0;
  $("search-count").textContent = matches.length + (matches.length===1 ? " matching school" : " matching schools");
  updateLookup();
}

function changeSeason() {
  const season = seasonData();
  const preferred = $("team").value || "mit";
  $("as-of").min = season.dates[0];
  $("as-of").max = season.dates.at(-1);
  $("as-of").value = season.dates.at(-1);
  $("date-range").textContent = season.dates[0] + " to " + season.dates.at(-1);
  updateTeamList(preferred);
}

function selectedTeam() {
  return seasonData().teams.find(t => t.key === $("team").value);
}

function updateLookup() {
  const season = seasonData();
  const team = selectedTeam();
  const day = $("as-of").value;
  const asOfValid = day && day >= season.dates[0] && day <= season.dates.at(-1);
  let index = -1;
  if (asOfValid && team && team.ratings) {
    for (let i=season.dates.length-1;i>=0;i--) {
      if (season.dates[i]<=day && Number.isFinite(team.ratings[i])) {
        index=i; break;
      }
    }
  }
  selectedRating = index<0 ? null : {
    name:team.name, value:team.ratings[index], date:season.dates[index],
    season:$("season").value
  };
  $("selected-team").textContent = team ? team.name : "No matching school";
  $("lookup-npi").textContent = selectedRating ? selectedRating.value.toFixed(3) : "—";
  $("lookup-date").textContent = selectedRating ? "Rating through "+selectedRating.date :
    !team ? "Try a different search." :
    !team.ratings ? "No rating in this frozen historical dataset." :
    !asOfValid ? "Choose a date within the selected season." :
    "No rating on or before this date.";
  $("use-ours").disabled = $("use-opp").disabled = !selectedRating;
  drawTrend(team,season,index);
}

function svgNode(tag, attributes={}, text="") {
  const node = document.createElementNS("http://www.w3.org/2000/svg",tag);
  for (const [k,v] of Object.entries(attributes)) node.setAttribute(k,String(v));
  if (text) node.textContent=text;
  return node;
}

function drawTrend(team,season,selectedIndex) {
  const svg=$("trend-chart");
  svg.replaceChildren();
  $("trend-label").textContent = team ? team.name+" · "+$("season").value : "";
  $("trend-summary").textContent="";
  const values=team && team.ratings ? team.ratings : [];
  const points=values.map((v,i)=>({v,i})).filter(p=>Number.isFinite(p.v));
  svg.hidden = points.length===0;
  $("trend-empty").hidden = points.length>0;
  if (!points.length) {
    $("trend-empty").textContent=team ? "No historical NPI trend available for this school." : "Select a school to see its historical trend.";
    return;
  }
  const left=54,right=620,top=15,bottom=215;
  let low=Math.floor(Math.min(...points.map(p=>p.v))/10)*10;
  let high=Math.ceil(Math.max(...points.map(p=>p.v))/10)*10;
  if (high===low) {low-=5;high+=5;}
  const days=season.dates.map(d=>Date.parse(d+"T00:00:00Z"));
  const span=days.at(-1)-days[0] || 1;
  const x=i=>left+(right-left)*(days[i]-days[0])/span;
  const y=v=>bottom-(bottom-top)*(v-low)/(high-low);
  for(let i=0;i<=4;i++){
    const v=low+(high-low)*i/4;
    svg.append(svgNode("line",{x1:left,x2:right,y1:y(v),y2:y(v),class:"grid-line"}));
    svg.append(svgNode("text",{x:left-8,y:y(v)+4,"text-anchor":"end"},v.toFixed(1)));
  }
  for(let j=0;j<4;j++){
    const i=Math.round((season.dates.length-1)*j/3);
    const label=season.dates[i].slice(5).replace("-","/");
    svg.append(svgNode("text",{x:x(i),y:238,"text-anchor":j===0?"start":j===3?"end":"middle"},label));
  }
  let path="", connected=false;
  for(let i=0;i<values.length;i++){
    if(!Number.isFinite(values[i])) {connected=false;continue;}
    path+=(connected?" L":" M")+x(i).toFixed(2)+","+y(values[i]).toFixed(2);
    connected=true;
  }
  svg.append(svgNode("path",{d:path,class:"trend-line"}));
  if(points.length===1) svg.append(svgNode("circle",{cx:x(points[0].i),cy:y(points[0].v),r:4,class:"selected-point"}));
  if(selectedIndex>=0){
    svg.append(svgNode("line",{x1:x(selectedIndex),x2:x(selectedIndex),y1:top,y2:bottom,class:"selected-line"}));
    svg.append(svgNode("circle",{cx:x(selectedIndex),cy:y(values[selectedIndex]),r:4.5,class:"selected-point"}));
  }
  svg.setAttribute("aria-label",team.name+" "+$("season").value+" reconstructed NPI trend");
  const first=points[0],last=points.at(-1);
  $("trend-summary").textContent="First available: "+first.v.toFixed(3)+" ("+season.dates[first.i]+
    ") · Latest: "+last.v.toFixed(3)+" ("+season.dates[last.i]+") · "+points.length+" daily observations";
}

function useRating(which) {
  if(!selectedRating) return;
  const input=which==="ours"?ourInput:oppInput;
  input.value=selectedRating.value.toFixed(3);
  inputSources[which]=selectedRating.name+" · through "+selectedRating.date+" (historical)";
  calculate();
  input.focus({preventScroll:true});
  document.getElementById("calculator-title").scrollIntoView({behavior:"smooth",block:"nearest"});
}

$("season").addEventListener("change",changeSeason);
$("team-search").addEventListener("input",()=>updateTeamList());
$("team").addEventListener("change",updateLookup);
$("as-of").addEventListener("change",updateLookup);
$("use-ours").addEventListener("click",()=>useRating("ours"));
$("use-opp").addEventListener("click",()=>useRating("opp"));

calculate();

fetch("historical_npi.json")
  .then(response=>{
    if(!response.ok) throw new Error("HTTP "+response.status);
    return response.json();
  })
  .then(data=>{
    if(!data.seasons || !data.seasons["2024"] || !data.seasons["2025"]) throw new Error("Invalid archive");
    archive=data;
    $("history-controls").hidden=false;
    $("load-status").hidden=true;
    changeSeason();
  })
  .catch(error=>{
    console.error(error);
    $("load-status").hidden=false;
    $("load-status").textContent="Historical archive could not be loaded. The manual calculator still works. Open the page using a local web server or GitHub Pages, rather than directly as a file.";
  });

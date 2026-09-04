import hashlib, json, re, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

SOURCES = [
    ("Japan", Path(r"D:\downloads\日军cdss提示版翻译.docx")),
    ("Allies", Path(r"D:\downloads\盟军cdss提示板翻译.docx")),
]
OUT = Path(__file__).resolve().parents[2] / "data" / "erasmus" / "cdss_sources.json"

def paragraphs(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    rows=[]
    for p in root.iter():
        if p.tag.rsplit("}",1)[-1] != "p": continue
        text="".join(n.text or "" for n in p.iter() if n.tag.rsplit("}",1)[-1] == "t").strip()
        if text: rows.append(text)
    return rows

result={"schema_version":1,"sources":[]}
for role,path in SOURCES:
    raw=path.read_bytes(); rows=paragraphs(path); section=None; section_no=None; out=[]
    for i,text in enumerate(rows,1):
        m=re.search(r"卡面\s*([1-6])",text) if role=="Japan" else None
        if not m and role=="Allies":
            labels=["早期阶段决策轴","中期阶段决策轴","尾声阶段决策轴","全阶段卡牌选择","全阶段特遣部队编成","全阶段反应和战后移动"]
            for n,label in enumerate(labels,7):
                if label in text: m=type("M",(),{"group":lambda self,_:str(n)})()
        if m: section_no=int(m.group(1)); section=f"page-{section_no:02d}"
        out.append({"paragraph":i,"section":section,"text":text})
    result["sources"].append({"role":role,"path":str(path).replace("\\","/"),"sha256":hashlib.sha256(raw).hexdigest(),"paragraph_count":len(rows),"paragraphs":out})
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(f"wrote {OUT}: "+", ".join(f"{x['role']}={x['paragraph_count']}" for x in result["sources"]))

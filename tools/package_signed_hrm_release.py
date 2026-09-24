from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, sys, zipfile

REPO=Path(__file__).resolve().parents[1]
CORE=REPO/'core'/'1.0.0'

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ns=ap.parse_args()
    manifest=CORE/'release.json'
    pub=CORE/'signatures'/'HRM_FOUNDER.pub'
    sig=CORE/'release.json.minisig'
    if not (manifest.is_file() and pub.is_file() and sig.is_file()):
        raise SystemExit('Missing signed release verification artifacts')
    if not shutil.which('minisign'):
        raise SystemExit('minisign not installed')
    vr=subprocess.run(['minisign','-Vm',str(manifest),'-p',str(pub)],capture_output=True,text=True)
    if vr.returncode:
        raise SystemExit('Signature verification failed: '+(vr.stdout+vr.stderr))
    data=json.loads(manifest.read_text(encoding='utf-8'))
    bad=[]
    for x in data['payload']:
        f=CORE/x['path']
        if not f.is_file() or sha(f)!=x['sha256']: bad.append(x['path'])
    if bad: raise SystemExit('Payload integrity failed: '+', '.join(bad))
    out=Path(ns.out); out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists(): out.unlink()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for f in sorted(x for x in CORE.rglob('*') if x.is_file()):
            rel=f.relative_to(CORE).as_posix()
            info=zipfile.ZipInfo(rel,(2026,9,24,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=(0o644 & 0xffff)<<16
            z.writestr(info,f.read_bytes())
    result={'ok':True,'release_json_sha256':sha(manifest),'zip':str(out),'zip_sha256':sha(out),'bytes':out.stat().st_size}
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
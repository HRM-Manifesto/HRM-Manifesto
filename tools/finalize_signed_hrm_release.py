from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, sys, zipfile, datetime
ROOT=Path(r'D:\MANIFEST'); REPO=ROOT/'GitHub'/'HRM-Manifesto'; CORE=REPO/'core'/'1.0.0'
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--public-key',required=True); ns=ap.parse_args(); pub=Path(ns.public_key)
    manifest=CORE/'release.json'; sig=CORE/'release.json.minisig'
    if not pub.is_file(): raise SystemExit('Public key file not found')
    if not sig.is_file(): raise SystemExit('release.json.minisig not found - founder must sign manually first')
    data=json.loads(manifest.read_text(encoding='utf-8'))
    bad=[]
    for x in data['payload']:
        p=CORE/x['path']
        if not p.is_file() or sha(p)!=x['sha256']: bad.append(x['path'])
    if bad: raise SystemExit('Payload integrity failure: '+', '.join(bad))
    p=subprocess.run(['minisign','-Vm',str(manifest),'-p',str(pub)],capture_output=True,text=True)
    if p.returncode: raise SystemExit('Founder signature verification failed: '+(p.stdout+p.stderr))
    sdir=CORE/'signatures'; sdir.mkdir(exist_ok=True)
    shutil.copy2(pub,sdir/'HRM_FOUNDER.pub'); shutil.copy2(sig,sdir/'release.json.minisig')
    (sdir/'PUBLIC_KEY_SHA256.txt').write_text(sha(pub)+'  HRM_FOUNDER.pub\n',encoding='ascii')
    outdir=ROOT/'Wydania'/'ZATWIERDZONE'; outdir.mkdir(parents=True,exist_ok=True); out=outdir/'HRM-Core-1.0.0-SIGNED.zip'
    if out.exists(): out.unlink()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for f in sorted(x for x in CORE.rglob('*') if x.is_file()):
            info=zipfile.ZipInfo(f.relative_to(CORE).as_posix(),(2026,9,24,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.external_attr=(0o644 & 0xffff)<<16; z.writestr(info,f.read_bytes())
    receipt={'release_id':'hrm-core-1.0.0','finalized_at':datetime.datetime.now().astimezone().isoformat(),'release_json_sha256':sha(manifest),'public_key_sha256':sha(pub),'signed_zip':str(out),'signed_zip_sha256':sha(out),'signature_verified':True}
    (outdir/'HRM-Core-1.0.0-SIGNED.receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
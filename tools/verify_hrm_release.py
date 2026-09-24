from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, sys

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser(description='Verify HRM release integrity and optional Minisign signature')
    ap.add_argument('release_dir', nargs='?', default=r'D:\MANIFEST\GitHub\HRM-Manifesto\core\1.0.0')
    ap.add_argument('--public-key', dest='public_key')
    ns=ap.parse_args(); root=Path(ns.release_dir); manifest=root/'release.json'
    report={'release_dir':str(root),'integrity_ok':False,'signature':'not_checked','missing':[],'bad_hashes':[]}
    if not manifest.exists():
        report['missing'].append('release.json'); print(json.dumps(report,indent=2)); return 2
    data=json.loads(manifest.read_text(encoding='utf-8'))
    for item in data.get('payload',[]):
        p=root/item['path']
        if not p.exists(): report['missing'].append(item['path'])
        elif sha256(p)!=item['sha256']: report['bad_hashes'].append(item['path'])
    report['integrity_ok']=not report['missing'] and not report['bad_hashes']
    sig=manifest.with_suffix(manifest.suffix+'.minisig')
    if ns.public_key:
        if not sig.exists(): report['signature']='missing_signature'
        elif not shutil.which('minisign'): report['signature']='minisign_not_installed'
        else:
            p=subprocess.run(['minisign','-Vm',str(manifest),'-p',str(ns.public_key)],capture_output=True,text=True)
            report['signature']='valid' if p.returncode==0 else 'invalid'
            report['signature_output']=(p.stdout+p.stderr).strip()
    elif sig.exists(): report['signature']='signature_present_public_key_not_supplied'
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['integrity_ok'] and report['signature'] not in ('invalid','missing_signature') else 1
if __name__=='__main__': sys.exit(main())
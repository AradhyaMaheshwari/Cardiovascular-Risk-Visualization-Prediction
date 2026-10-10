import json, joblib, numpy as np, pandas as pd
from pathlib import Path
from common import *
from sklearn.metrics import *
OUT=Path("artifacts"); X,y=load()
oof={t:np.load(OUT/f"oof_{t}.npy") for t in TARGETS}
def thr(yt,ps):
    g=np.linspace(0.25,0.75,51)
    sc=np.mean([[balanced_accuracy_score(yt,p>=t) for t in g] for p in ps],axis=0)
    sc=np.convolve(sc,np.ones(5)/5,mode="same")   # smooth to avoid a spiky, overfit threshold
    return float(g[2:-2][np.argmax(sc[2:-2])])
rows=[];th={}
def row(t,name,yt,ps,T):
    r=[];
    for p in ps:
        pr=(p>=T).astype(int); tn,fp,fn,tp=confusion_matrix(yt,pr).ravel()
        r.append([accuracy_score(yt,pr),precision_score(yt,pr),recall_score(yt,pr),tn/(tn+fp),f1_score(yt,pr),balanced_accuracy_score(yt,pr),roc_auc_score(yt,p),brier_score_loss(yt,p)])
    m=np.mean(r,axis=0)
    rows.append(dict(Target=t,Evaluation=name,Threshold=round(T,2),**dict(zip(["Accuracy","Precision","Recall","Specificity","F1","BalancedAcc","ROC_AUC","Brier"],m.round(3)))))
for t in TARGETS:
    T=thr(y[t],oof[t]); th[t]=round(T,2)
    row(t,"CV default 0.50",y[t],oof[t],0.5); row(t,"CV tuned threshold",y[t],oof[t],T)
# hierarchy: CAD prob >= max vessel prob
hier=np.maximum(oof["Cath"],np.max([oof[v] for v in ["LAD","LCX","RCA"]],axis=0)) 
print("Cath AUC raw",np.mean([roc_auc_score(y.Cath,p) for p in oof["Cath"]]).round(3),"hier",np.mean([roc_auc_score(y.Cath,p) for p in hier]).round(3))
print("violations raw:",(oof["Cath"]<np.max([oof[v] for v in ["LAD","LCX","RCA"]],axis=0)).mean().round(3))
d=pd.DataFrame(rows); print(d.to_string(index=False))
d.to_csv(OUT/"cv_metrics.csv",index=False)
json.dump(th,open(OUT/"thresholds.json","w"),indent=2)
json.dump(list(X.columns),open(OUT/"feature_columns.json","w"),indent=2)
joblib.dump(dict(target_columns=TARGETS,input_feature_columns=list(X.columns),thresholds=th,
  encoding=dict(Sex="Male=1/Female=0",BBB="0=none,1=LBBB/RBBB",VHD="N=0,mild=1,moderate=2,severe=3",YN="Y=1,N=0"),
  note="Decision support / educational only; not a diagnosis."),OUT/"model_metadata.pkl")

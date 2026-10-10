import sys, numpy as np, pandas as pd, time
from common import *
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.metrics import roc_auc_score, balanced_accuracy_score, brier_score_loss
from sklearn.base import clone
X,y=load()
t=sys.argv[1]
cands=["LR_l2","LR_l1","RF","ET","HGB","ENS"]
rskf=RepeatedStratifiedKFold(n_splits=5,n_repeats=2,random_state=7)
rows=[]
for c in cands:
    aucs=[];bas=[];br=[]
    for tr,te in rskf.split(X,y[t]):
        p=clone(mk(c,X)).fit(X.iloc[tr],y[t].iloc[tr]).predict_proba(X.iloc[te])[:,1]
        aucs.append(roc_auc_score(y[t].iloc[te],p)); br.append(brier_score_loss(y[t].iloc[te],p)); bas.append(balanced_accuracy_score(y[t].iloc[te],p>=0.5))
    rows.append(dict(target=t,model=c,AUC=round(np.mean(aucs),3),sd=round(np.std(aucs),3),BalAcc=round(np.mean(bas),3),Brier=round(np.mean(br),3)))
pd.DataFrame(rows).to_csv(f"bench_{t}.csv",index=False)
print(pd.DataFrame(rows).to_string(index=False))

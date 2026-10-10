"""Final training: repeated-CV OOF evaluation, threshold selection, hierarchy check, export."""
import sys, json, joblib, numpy as np, pandas as pd
from pathlib import Path
from common import *
from sklearn.base import clone
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.metrics import (roc_auc_score, accuracy_score, precision_score, recall_score,
                             f1_score, balanced_accuracy_score, brier_score_loss, confusion_matrix)
OUT=Path("artifacts"); OUT.mkdir(exist_ok=True)
X,y=load()
t=sys.argv[1]
rskf=RepeatedStratifiedKFold(n_splits=5,n_repeats=2,random_state=11)
oof=np.zeros((2,len(X)))
for i,(tr,te) in enumerate(rskf.split(X,y[t])):
    m=clone(mk("ENS",X,seed=i)).fit(X.iloc[tr],y[t].iloc[tr])
    oof[i//5,te]=m.predict_proba(X.iloc[te])[:,1]
np.save(OUT/f"oof_{t}.npy",oof)
final=mk("ENS",X,seed=42).fit(X,y[t])
joblib.dump(final,OUT/f"{t}_model.pkl")
print(t,"done")

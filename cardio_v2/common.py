import numpy as np, pandas as pd, warnings
warnings.filterwarnings("ignore")
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier, HistGradientBoostingClassifier, VotingClassifier
from sklearn.calibration import CalibratedClassifierCV

DATA="/mnt/user-data/uploads/extention_of_Z-Alizadeh_sani_dataset.xlsx"
TARGETS=["Cath","LAD","LCX","RCA"]

def load():
    df=pd.read_excel(DATA); df.columns=[c.strip() for c in df.columns]
    y=pd.DataFrame({t:(df[t].astype(str).str.strip().str.lower().isin(["cad","stenotic"])).astype(int) for t in TARGETS})
    X=df.drop(columns=TARGETS).copy()
    for c in X.columns:
        if not pd.api.types.is_numeric_dtype(X[c]):
            s=X[c].astype(str).str.strip().str.lower()
            if set(s.unique())<= {"y","n"}: X[c]=s.map({"y":1,"n":0}).astype(float)
            elif c.lower()=="sex": X[c]=(s.isin(["male","m"])).astype(float)
            elif c=="BBB": X[c]=(s!="n").astype(float)          # any bundle-branch block
            elif c=="VHD": X[c]=s.map({"n":0,"mild":1,"moderate":2,"severe":3}).astype(float)  # ordinal severity
            else: X[c]=s
    return X,y

class FE(BaseEstimator, TransformerMixin):
    """Stateless domain features + drop redundant anthropometrics."""
    def __init__(self, add=True): self.add=add
    def fit(self,X,y=None): return self
    def transform(self,X):
        X=X.copy()
        if self.add:
            X["TC_HDL_proxy"]=(X["LDL"]+X["HDL"])/X["HDL"].clip(lower=1)
            X["TG_HDL"]=X["TG"]/X["HDL"].clip(lower=1)
            X["NLR"]=X["Neut"]/X["Lymph"].clip(lower=1)
            X["RiskCount"]=X[["DM","HTN","Current Smoker","EX-Smoker","FH","DLP","Obesity"]].sum(axis=1)
            X["ECG_Abn"]=X[["Q Wave","St Elevation","St Depression","Tinversion","LVH","Poor R Progression","BBB"]].sum(axis=1)
            X["AnginaScore"]=X[["Typical Chest Pain","Atypical","Exertional CP","LowTH Ang"]].sum(axis=1)
            X["Age_x_HTN"]=X["Age"]*X["HTN"]
            for c in ["FBS","TG","CR","BUN","ESR","WBC","PLT"]: X[c]=np.log1p(X[c])
        X=X.drop(columns=["Weight","Length"],errors="ignore")
        return X

def prep(X_sample, scale=True):
    num=X_sample.select_dtypes("number").columns.tolist()
    cat=[c for c in X_sample.columns if c not in num]
    t=[("n",Pipeline([("i",SimpleImputer(strategy="median")),("s",StandardScaler() if scale else "passthrough")]),num)]
    if cat: t.append(("c",Pipeline([("i",SimpleImputer(strategy="most_frequent")),("o",OneHotEncoder(handle_unknown="ignore"))]),cat))
    return ColumnTransformer(t,verbose_feature_names_out=False)

def mk(name, X, seed=0, fe=True):
    Xf=FE(fe).fit_transform(X.head(5))
    P=lambda sc=True: prep(Xf,sc)
    m={
     "LR_l2":      LogisticRegression(C=0.1,max_iter=5000,class_weight="balanced"),
     "LR_l1":      LogisticRegression(C=0.15,penalty="l1",solver="liblinear",max_iter=5000,class_weight="balanced"),
     "RF":         RandomForestClassifier(n_estimators=500,min_samples_leaf=3,max_features="sqrt",class_weight="balanced_subsample",random_state=seed,n_jobs=1),
     "ET":         ExtraTreesClassifier(n_estimators=500,min_samples_leaf=2,max_features="sqrt",class_weight="balanced_subsample",random_state=seed,n_jobs=1),
     "HGB":        HistGradientBoostingClassifier(max_depth=3,learning_rate=0.04,max_iter=150,min_samples_leaf=12,l2_regularization=2.0,max_features=0.5,random_state=seed),
    }
    if name=="ENS":
        est=VotingClassifier([("lr",m["LR_l2"]),("rf",m["RF"]),("et",m["ET"]),("hgb",m["HGB"])],voting="soft")
    else: est=m[name]
    return Pipeline([("fe",FE(fe)),("prep",P()),("model",est)])

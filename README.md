# ⬡ POPSPACE AI — Vercel 배포 가이드

## 배포 방법 (5분)

### 1. GitHub에 올리기
```bash
git init
git add .
git commit -m "POPSPACE AI"
git remote add origin https://github.com/YOUR_ID/popspace-ai
git push -u origin main
```

### 2. Vercel 배포
1. [vercel.com](https://vercel.com) → GitHub로 로그인
2. "New Project" → GitHub 레포 선택
3. Deploy 클릭 → 자동 배포 완료

### 3. 환경변수 설정 (선택사항)
Vercel 대시보드 → Settings → Environment Variables
```
GEMINI_API_KEY = AIzaSy...
```
> 설정하면 사용자가 키를 입력 안 해도 됨

### 4. 접속
배포 완료 후 `https://popspace-xxx.vercel.app` 주소로 
**폰, 태블릿, PC 어디서든** 접속 가능!

## 파일 구조
```
popspace-vercel/
├── index.html        # 메인 앱 (모바일 대응)
├── vercel.json       # Vercel 설정
├── api/
│   └── gemini.js     # Gemini API 프록시 (서버리스)
└── README.md
```

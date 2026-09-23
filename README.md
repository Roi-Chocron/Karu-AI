# Karu AI - Web Cloud Export 🌐
**פלטפורמה חכמה ליצירה ואוטומציה של קרוסלות אינסטגרם מקצועיות מונעות AI**

חבילת ייצוא זו (`KaruAI - Export`) מוקדשת **אך ורק לגרסת הווב (Web Edition)** להרצה מלאה בענן, ללא אפליקציית מובייל/APK, ללא קובצי זבל וללא תלויות מקומיות מיותרות.

---

## 📁 מבנה התיקייה

```text
KaruAI - Export/
├── cloudflare-serverless/   # פריסת ענן Edge מלאה (Cloudflare Workers + D1 + KV + Workers AI + Frontend)
├── docker-container/        # פריסת ענן בקונטיינר (Node.js Express + Playwright + Docker Compose)
├── assets/                  # נכסי מותג (לוגואים וקטוריים SVG ופרומפט מנהל העיצוב הראשי)
├── CLOUD_DEPLOYMENT_GUIDE.md # מדריך פריסה מפורט צעד-אחר-צעד בענן
├── TASKS_AND_SUMMARY.md     # רשימת משימות מלאה וסיכום הנדסי
└── README.md                # קובץ זה
```

---

## ⚡ שתי אפשרויות הפריסה בענן

המערכת מסופקת בשני מודלים עצמאיים של שרת ווב לפי העדפתך:

### 1. Cloudflare Serverless (מומלץ ביותר לחסכון, מהירות ו-Zero Maintenance) 🌟
- **ארכיטקטורה:** שרת קצה (Edge) מלא ב-Hono, מסד נתונים D1 (SQL בענן), אחסון תמונות ב-KV, ומודלי AI של Cloudflare (Llama 3.3 70B Fast + FLUX.1 / SDXL).
- **צד לקוח:** כל דפי הווב מוגשים ישירות מ-Cloudflare Assets.
- **הפעלה מהירה:**
  ```bash
  cd cloudflare-serverless
  npm install
  npx wrangler deploy
  ```

### 2. Docker Container (מתאים ל-VPS, Railway, Render, Fly.io) 🐳
- **ארכיטקטורה:** שרת Node.js 22 מבוסס Express עם תמיכה מובנית ברינדור Playwright, מסד נתונים SQLite מתמיד עם כרכי אחסון (Volumes), ואינטגרציות מלאות ל-Polar.sh ול-Meta Graph API.
- **הפעלה מהירה:**
  ```bash
  cd docker-container
  cp .env.example .env
  # ערוך את קובץ .env עם המפתחות שלך
  docker compose up -d --build
  ```

---

## 🔑 הגדרות משתני סביבה
לפני הרצה בייצור, יש לוודא שהוגדרו המפתחות הבאים:
1. **JWT_SECRET:** מפתח הצפנה מאובטח לחתימת טוקנים של משתמשים.
2. **Polar.sh:** עבור מנויים וסליקת תשלומים (`POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_*`).
3. **Meta / Instagram:** לפרסום אוטומטי (`FB_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID`).

למדריך המלא שלב-אחר-שלב, עיין בקובץ [CLOUD_DEPLOYMENT_GUIDE.md](./CLOUD_DEPLOYMENT_GUIDE.md).
לפירוט המשימות והסיכום הטכני, עיין בקובץ [TASKS_AND_SUMMARY.md](./TASKS_AND_SUMMARY.md).

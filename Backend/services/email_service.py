import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
APP_URL       = os.getenv("APP_URL", "http://localhost:5173")
BRAND_COLOR   = "#6366f1"


def _send(to: str, subject: str, html: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"NovaMind <{SMTP_USER}>"
    msg["To"]      = to
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        s.starttls()
        s.login(SMTP_USER, SMTP_PASSWORD)
        s.sendmail(SMTP_USER, to, msg.as_string())


def send_verification_code(user_email: str, code: str):
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
      <h2 style="color:#111;margin-bottom:8px">Vérification de votre email</h2>
      <p style="color:#555">Votre code de vérification à usage unique :</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:12px;color:{BRAND_COLOR};
                  background:#f4f4ff;border-radius:10px;padding:20px 0;text-align:center;
                  margin:24px 0">{code}</div>
      <p style="color:#888;font-size:13px">Ce code expire dans <strong>15 minutes</strong>.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#bbb;font-size:11px">NovaMind — ne répondez pas à cet email.</p>
    </div>
    """
    _send(user_email, "Code de vérification — NovaMind", html)


def send_intervention_request_to_client(
    client_email: str,
    question: str,
    ticket_id: str,
    bot_name: str,
):
    respond_url = f"{APP_URL}/?client=true#/tickets/{ticket_id}"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
      <h2 style="color:#111">Intervention humaine requise</h2>
      <p style="color:#555">Un utilisateur de <strong>{bot_name}</strong> attend votre réponse :</p>
      <blockquote style="background:#f9f9f9;border-left:4px solid {BRAND_COLOR};
                          padding:16px 20px;border-radius:6px;margin:20px 0;
                          font-size:15px;color:#222">{question}</blockquote>
      <a href="{respond_url}"
         style="display:inline-block;background:{BRAND_COLOR};color:#fff;
                padding:13px 28px;border-radius:8px;text-decoration:none;
                font-weight:600;font-size:15px">
        Répondre à l'utilisateur →
      </a>
      <p style="color:#bbb;font-size:11px;margin-top:28px">Ticket : {ticket_id}</p>
    </div>
    """
    _send(client_email, f"[{bot_name}] Intervention requise", html)


def send_answer_to_user(
    user_email: str,
    question: str,
    answer: str,
    bot_name: str,
):
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
      <h2 style="color:#111">Réponse de l'équipe {bot_name}</h2>
      <p style="color:#555"><strong>Votre question :</strong></p>
      <blockquote style="background:#f4f4ff;border-left:4px solid {BRAND_COLOR};
                          padding:14px 18px;border-radius:6px;margin:12px 0;color:#333">{question}</blockquote>
      <p style="color:#555"><strong>Réponse :</strong></p>
      <div style="background:#f9fffe;border:1px solid #d0f0e8;border-radius:8px;
                  padding:16px 20px;color:#222;line-height:1.6">{answer}</div>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#bbb;font-size:11px">Réponse fournie manuellement par l'équipe support — NovaMind.</p>
    </div>
    """
    _send(user_email, f"Réponse à votre question — {bot_name}", html)

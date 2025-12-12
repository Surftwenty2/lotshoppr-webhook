export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN
      },
      body: JSON.stringify({
        From: process.env.MAIL_FROM,
        To: "sean@lotshoppr.com",
        Subject: "LotShoppr app test",
        TextBody: "This email was sent from the LotShoppr app via Postmark.",
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM
      })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

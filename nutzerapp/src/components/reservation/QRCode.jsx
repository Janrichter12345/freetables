import { QRCodeCanvas } from "qrcode.react";

export default function QRCode({ value, size = 220 }) {
  return <QRCodeCanvas value={value} size={size} includeMargin />;
}

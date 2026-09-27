function detectCarrier(num) {
  const n = num.trim().replace(/[\s-]/g, '').toUpperCase();
  if (/^1Z[A-Z0-9]{16}$/.test(n))                           return 'ups';
  if (/^T\d{10}$/.test(n))                                   return 'ups';
  if (/^(96|98|77|61|02|03|62|88)\d{18,20}/.test(n))        return 'fedex';
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n))             return 'fedex';
  if (/^(94|93|92|9400|9205|9206|9407|9208|9300|9261|9274|9275|9276|9278|9279|9202|9261)\d+/.test(n)) return 'usps';
  if (/^(70|71|73|77|80|81|83|85|86|87|88|89|91|92|93|94|95|96|97|98|99)\d{18}$/.test(n)) return 'usps';
  if (/^\d{10}$/.test(n) && n.startsWith('0'))               return 'usps';
  if (/^[0-9]{10}JD/.test(n) || /^JD\d{18}$/.test(n))      return 'dhl';
  if (/^\d{10,11}$/.test(n))                                  return 'dhl';
  return null;
}

function trackingUrl(carrier, num) {
  const n = encodeURIComponent(String(num).trim().replace(/\s/g, ''));
  switch (carrier) {
    case 'ups':   return `https://www.ups.com/track?tracknum=${n}&requester=WT/trackdetails`;
    case 'fedex': return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case 'usps':  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case 'dhl':   return `https://www.dhl.com/en/express/tracking.html?AWB=${n}&brand=DHL`;
    default:      return `https://www.google.com/search?q=track+package+${n}`;
  }
}


module.exports = { detectCarrier, trackingUrl };

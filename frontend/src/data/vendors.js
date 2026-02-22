// Common auto body parts vendors — pre-populated for faster parts entry
export const VENDORS = [
  // Recycled / Used Parts
  { name: "LKQ Corporation",           phone: "1-800-587-2720", type: "Recycled/OEM",    website: "https://www.lkqcorp.com" },
  { name: "Keystone Automotive",       phone: "1-800-233-3158", type: "Aftermarket",      website: "https://www.keystoneautomotive.com" },
  { name: "Car-Part.com",              phone: "1-859-344-1925", type: "Recycled",         website: "https://www.car-part.com" },
  { name: "eBay Motors",               phone: "",               type: "Marketplace",      website: "https://www.ebay.com/motors" },
  // OEM Dealers / New Parts
  { name: "OEM Wholesale",             phone: "1-877-674-7562", type: "OEM",              website: "https://www.oemwholesale.com" },
  { name: "Dealer Parts Direct",       phone: "1-888-748-0665", type: "OEM",              website: "https://www.dealerpartsdirect.com" },
  { name: "CollisionLink (OEM)",       phone: "1-888-776-5287", type: "OEM",              website: "https://www.collisionlink.com" },
  { name: "OEMCollision",              phone: "",               type: "OEM",              website: "https://www.oemcollision.com" },
  // Aftermarket
  { name: "PartsSource",               phone: "1-877-999-7278", type: "Aftermarket",      website: "https://www.partssource.com" },
  { name: "AutoZone Commercial",        phone: "1-800-288-6966", type: "Aftermarket",      website: "https://www.autozone.com" },
  { name: "O'Reilly Auto Parts",        phone: "1-417-862-3333", type: "Aftermarket",      website: "https://www.oreillyauto.com" },
  { name: "NAPA Auto Parts",            phone: "1-800-538-6272", type: "Aftermarket",      website: "https://www.napaonline.com" },
  { name: "Advance Auto Parts",         phone: "1-877-238-2623", type: "Aftermarket",      website: "https://www.advanceautoparts.com" },
  { name: "RockAuto",                   phone: "",               type: "Aftermarket",      website: "https://www.rockauto.com" },
  { name: "Dorman Products",            phone: "1-800-523-2492", type: "Aftermarket",      website: "https://www.dormanproducts.com" },
  // Glass
  { name: "Safelite AutoGlass",         phone: "1-800-638-8958", type: "Glass",            website: "https://www.safelite.com" },
  { name: "PGW Auto Glass",             phone: "1-800-922-3396", type: "Glass",            website: "https://www.pgwglass.com" },
  { name: "PPG Auto Glass",             phone: "1-888-774-8639", type: "Glass",            website: "https://www.ppgindustries.com" },
  { name: "Carlisle Auto Glass",        phone: "",               type: "Glass",            website: "" },
  // Paint / Refinishing
  { name: "PPG Industries",             phone: "1-888-774-8639", type: "Paint",            website: "https://www.ppgrefinish.com" },
  { name: "Axalta Coating Systems",     phone: "1-800-247-3886", type: "Paint",            website: "https://www.axaltacs.com" },
  { name: "BASF Automotive Coatings",   phone: "1-800-825-3000", type: "Paint",            website: "https://www.basfrefinish.com" },
  { name: "Sherwin-Williams Auto",      phone: "1-800-798-5872", type: "Paint",            website: "https://www.sherwin-automotive.com" },
  { name: "Matrix Paint Systems",       phone: "1-888-462-8749", type: "Paint",            website: "https://www.matrixsystem.com" },
  { name: "Nason Paint",                phone: "1-800-321-2500", type: "Paint",            website: "" },
  // Structural / Mechanical
  { name: "Caliber Collision",          phone: "",               type: "Sublet",           website: "https://www.calibercollision.com" },
  { name: "Gerber Collision",           phone: "1-800-459-9495", type: "Sublet",           website: "https://www.gerbercollision.com" },
  // Supplies
  { name: "3M Automotive",              phone: "1-800-364-3577", type: "Supplies",         website: "https://www.3m.com/collision" },
  { name: "Evercoat",                   phone: "1-800-322-7278", type: "Body Filler",      website: "https://www.evercoat.com" },
  { name: "U-POL Products",             phone: "1-800-526-5201", type: "Supplies",         website: "https://www.u-pol.com" },
];

export function searchVendors(query) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  return VENDORS.filter(v => v.name.toLowerCase().includes(q) || v.type.toLowerCase().includes(q)).slice(0, 8);
}

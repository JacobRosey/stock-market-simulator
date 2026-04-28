USE marketsim;

INSERT INTO stocks (ticker, name, sector, description, initial_price) VALUES
-- TECHNOLOGY
('NEXUS', 'Nexus Technologies', 'TECH', 'Big tech giant, stable revenue, massive market cap, slow growth', 250.00),
('QCI', 'Quantum Computing Inc.', 'TECH', 'Cutting-edge tech, high risk/reward, volatile, potential moonshot', 45.00),
('CLSE', 'CloudSecure', 'TECH', 'Cybersecurity/SaaS, steady recurring revenue, moderate growth', 85.00),
('NSMC', 'Nova Semiconductor', 'TECH', 'Chip manufacturer, cyclical, sensitive to supply/demand news', 65.00),

-- FINANCE
('AGB', 'Atlantic Global Bank', 'FINANCE', 'Megabank, too big to fail, stable but boring, dividend payer', 180.00),
('CRC', 'Crossroads Capital', 'FINANCE', 'Aggressive investment firm, high returns in good markets, crashes in bad', 55.00),
('SGI', 'SureGuard Insurance', 'FINANCE', 'Insurance giant, predictable premiums, boring but steady', 120.00),
('FINT', 'FinTech Innovations', 'FINANCE', 'Disruptive fintech startup, high growth, unproven long-term', 40.00),

-- RETAIL
('MEGA', 'MegaMart', 'RETAIL', 'Big box retailer, massive scale, thin margins, recession-resistant', 90.00),
('TREND', 'TrendSet', 'RETAIL', 'Fast fashion, trend-dependent, volatile quarterly results', 35.00),
('GLG', 'GreenLeaf Grocery', 'RETAIL', 'Organic grocery chain, premium prices, loyal customer base', 75.00),
('CLICK', 'ClickCart', 'RETAIL', 'E-commerce pure play, high growth, competition fears', 60.00),

-- MANUFACTURING
('IDYN', 'Industrial Dynamics', 'MANUFACTURING', 'Diversified industrial giant, global operations, steady', 150.00),
('AUTO', 'AutoBuild', 'MANUFACTURING', 'Automotive manufacturer, cyclical, sensitive to economy', 45.00),
('AERO', 'AeroSpace Tech', 'MANUFACTURING', 'Defense/aerospace contractor, government contracts, stable', 130.00),
('GSYS', 'GreenEnergy Systems', 'MANUFACTURING', 'Renewable energy manufacturing, growth potential, subsidy-dependent', 70.00),

-- PHARMA
('GMED', 'GlobalMed', 'PHARMA', 'Big pharma giant, diverse drug portfolio, reliable earnings', 200.00),
('BIOV', 'BioVenture', 'PHARMA', 'Biotech startup, pipeline-driven, binary outcomes (FDA approvals)', 25.00),
('GENH', 'GenericHealth', 'PHARMA', 'Generic drug manufacturer, thin margins, volume business', 40.00),
('NEURO', 'NeuroSynapse', 'PHARMA', 'Specialty neurology focus, niche market, high-margin drugs', 95.00);
 

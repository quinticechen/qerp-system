-- 為客戶表添加新欄位
ALTER TABLE customers 
ADD COLUMN landline_phone TEXT,
ADD COLUMN fax TEXT,
ADD COLUMN note TEXT;

-- 為工廠表添加新欄位  
ALTER TABLE factories
ADD COLUMN landline_phone TEXT,
ADD COLUMN fax TEXT,
ADD COLUMN note TEXT;
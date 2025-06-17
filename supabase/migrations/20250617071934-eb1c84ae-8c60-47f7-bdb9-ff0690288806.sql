
-- 建立使用者角色表（支援一個使用者多個角色）
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- 建立使用者操作日誌表
CREATE TABLE public.user_operation_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  operator_id UUID NOT NULL REFERENCES auth.users(id),
  target_user_id UUID REFERENCES auth.users(id),
  operation_type TEXT NOT NULL, -- 'create', 'update', 'disable', 'enable', 'role_grant', 'role_revoke'
  operation_details JSONB,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ip_address INET,
  user_agent TEXT
);

-- 啟用行級安全性
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_operation_logs ENABLE ROW LEVEL SECURITY;

-- 建立安全函數來檢查使用者角色
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role user_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND is_active = true
  );
$$;

-- 建立函數來檢查使用者是否為管理員
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'
      AND is_active = true
  );
$$;

-- RLS 政策：只有管理員可以查看所有使用者角色
CREATE POLICY "Admin can view all user roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- RLS 政策：使用者可以查看自己的角色
CREATE POLICY "Users can view their own roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS 政策：只有管理員可以管理使用者角色
CREATE POLICY "Admin can manage user roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- RLS 政策：只有管理員可以查看操作日誌
CREATE POLICY "Admin can view operation logs"
  ON public.user_operation_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- RLS 政策：所有認證使用者可以插入操作日誌（系統記錄用）
CREATE POLICY "Authenticated users can insert operation logs"
  ON public.user_operation_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (operator_id = auth.uid());

-- 建立觸發器來自動更新 updated_at
CREATE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 建立使用者視圖，方便查詢使用者及其角色
CREATE OR REPLACE VIEW public.users_with_roles AS
SELECT 
  p.id,
  p.email,
  p.full_name,
  p.phone,
  p.is_active,
  p.created_at,
  p.updated_at,
  COALESCE(
    json_agg(
      json_build_object(
        'role', ur.role,
        'granted_at', ur.granted_at,
        'granted_by', ur.granted_by,
        'is_active', ur.is_active
      )
    ) FILTER (WHERE ur.role IS NOT NULL), 
    '[]'::json
  ) as roles
FROM public.profiles p
LEFT JOIN public.user_roles ur ON p.id = ur.user_id AND ur.is_active = true
GROUP BY p.id, p.email, p.full_name, p.phone, p.is_active, p.created_at, p.updated_at;

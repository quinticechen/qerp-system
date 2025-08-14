export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      customers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          organization_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          organization_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      factories: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          organization_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          organization_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "factories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventories: {
        Row: {
          arrival_date: string
          created_at: string
          factory_id: string
          id: string
          note: string | null
          organization_id: string | null
          purchase_order_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          arrival_date?: string
          created_at?: string
          factory_id: string
          id?: string
          note?: string | null
          organization_id?: string | null
          purchase_order_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          arrival_date?: string
          created_at?: string
          factory_id?: string
          id?: string
          note?: string | null
          organization_id?: string | null
          purchase_order_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventories_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventories_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_with_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_rolls: {
        Row: {
          created_at: string
          current_quantity: number
          id: string
          inventory_id: string
          is_allocated: boolean
          product_id: string
          quality: Database["public"]["Enums"]["fabric_quality"]
          quantity: number
          roll_number: string
          shelf: string | null
          specifications: Json | null
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          current_quantity: number
          id?: string
          inventory_id: string
          is_allocated?: boolean
          product_id: string
          quality?: Database["public"]["Enums"]["fabric_quality"]
          quantity: number
          roll_number: string
          shelf?: string | null
          specifications?: Json | null
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          current_quantity?: number
          id?: string
          inventory_id?: string
          is_allocated?: boolean
          product_id?: string
          quality?: Database["public"]["Enums"]["fabric_quality"]
          quantity?: number
          roll_number?: string
          shelf?: string | null
          specifications?: Json | null
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_rolls_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_rolls_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_rolls_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_new"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_rolls_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      order_factories: {
        Row: {
          created_at: string
          factory_id: string
          id: string
          order_id: string
        }
        Insert: {
          created_at?: string
          factory_id: string
          id?: string
          order_id: string
        }
        Update: {
          created_at?: string
          factory_id?: string
          id?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_factories_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_factories_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_products: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          quantity: number
          shipped_quantity: number | null
          specifications: Json | null
          status: string | null
          total_rolls: number | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          quantity: number
          shipped_quantity?: number | null
          specifications?: Json | null
          status?: string | null
          total_rolls?: number | null
          unit_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          shipped_quantity?: number | null
          specifications?: Json | null
          status?: string | null
          total_rolls?: number | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_products_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_new"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          note: string | null
          order_number: string
          organization_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          shipping_status: Database["public"]["Enums"]["shipping_status"]
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          note?: string | null
          order_number: string
          organization_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_status?: Database["public"]["Enums"]["shipping_status"]
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          note?: string | null
          order_number?: string
          organization_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_status?: Database["public"]["Enums"]["shipping_status"]
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_with_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_roles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean
          is_system_role: boolean
          name: string
          organization_id: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          is_system_role?: boolean
          name: string
          organization_id: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          is_system_role?: boolean
          name?: string
          organization_id?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          owner_id: string
          settings: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          owner_id: string
          settings?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          owner_id?: string
          settings?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      products_new: {
        Row: {
          category: string
          color: string | null
          color_code: string | null
          created_at: string
          id: string
          name: string
          organization_id: string | null
          status: Database["public"]["Enums"]["product_status"] | null
          stock_thresholds: number | null
          unit_of_measure: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          category?: string
          color?: string | null
          color_code?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id?: string | null
          status?: Database["public"]["Enums"]["product_status"] | null
          stock_thresholds?: number | null
          unit_of_measure?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          category?: string
          color?: string | null
          color_code?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          status?: Database["public"]["Enums"]["product_status"] | null
          stock_thresholds?: number | null
          unit_of_measure?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_new_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_new_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_new_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_with_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          ordered_quantity: number
          ordered_rolls: number | null
          product_id: string
          purchase_order_id: string
          received_quantity: number | null
          specifications: Json | null
          status: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ordered_quantity: number
          ordered_rolls?: number | null
          product_id: string
          purchase_order_id: string
          received_quantity?: number | null
          specifications?: Json | null
          status?: string | null
          unit_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ordered_quantity?: number
          ordered_rolls?: number | null
          product_id?: string
          purchase_order_id?: string
          received_quantity?: number | null
          specifications?: Json | null
          status?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_new"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_relations: {
        Row: {
          created_at: string
          id: string
          order_id: string
          purchase_order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          purchase_order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          purchase_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_relations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_relations_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          expected_arrival_date: string | null
          factory_id: string
          id: string
          note: string | null
          order_date: string
          order_id: string | null
          organization_id: string | null
          po_number: string
          status: Database["public"]["Enums"]["purchase_order_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expected_arrival_date?: string | null
          factory_id: string
          id?: string
          note?: string | null
          order_date?: string
          order_id?: string | null
          organization_id?: string | null
          po_number: string
          status?: Database["public"]["Enums"]["purchase_order_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expected_arrival_date?: string | null
          factory_id?: string
          id?: string
          note?: string | null
          order_date?: string
          order_id?: string | null
          organization_id?: string | null
          po_number?: string
          status?: Database["public"]["Enums"]["purchase_order_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_with_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_history: {
        Row: {
          created_at: string
          customer_id: string
          date: string
          id: string
          note: string | null
          product_id: string
          quantity: number
          shipping_item_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          date?: string
          id?: string
          note?: string | null
          product_id: string
          quantity: number
          shipping_item_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          date?: string
          id?: string
          note?: string | null
          product_id?: string
          quantity?: number
          shipping_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_history_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shipment_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_new"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_history_shipping_item_id_fkey"
            columns: ["shipping_item_id"]
            isOneToOne: false
            referencedRelation: "shipping_items"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_items: {
        Row: {
          created_at: string
          id: string
          inventory_roll_id: string
          shipped_quantity: number
          shipping_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_roll_id: string
          shipped_quantity: number
          shipping_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_roll_id?: string
          shipped_quantity?: number
          shipping_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_items_inventory_roll_id_fkey"
            columns: ["inventory_roll_id"]
            isOneToOne: false
            referencedRelation: "inventory_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_items_shipping_id_fkey"
            columns: ["shipping_id"]
            isOneToOne: false
            referencedRelation: "shippings"
            referencedColumns: ["id"]
          },
        ]
      }
      shippings: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          note: string | null
          order_id: string
          organization_id: string | null
          shipping_date: string
          shipping_number: string
          total_shipped_quantity: number
          total_shipped_rolls: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          note?: string | null
          order_id: string
          organization_id?: string | null
          shipping_date?: string
          shipping_number: string
          total_shipped_quantity: number
          total_shipped_rolls: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          note?: string | null
          order_id?: string
          organization_id?: string | null
          shipping_date?: string
          shipping_number?: string
          total_shipped_quantity?: number
          total_shipped_rolls?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shippings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_with_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_operation_logs: {
        Row: {
          id: string
          ip_address: unknown | null
          operation_details: Json | null
          operation_type: string
          operator_id: string
          target_user_id: string | null
          timestamp: string
          user_agent: string | null
        }
        Insert: {
          id?: string
          ip_address?: unknown | null
          operation_details?: Json | null
          operation_type: string
          operator_id: string
          target_user_id?: string | null
          timestamp?: string
          user_agent?: string | null
        }
        Update: {
          id?: string
          ip_address?: unknown | null
          operation_details?: Json | null
          operation_type?: string
          operator_id?: string
          target_user_id?: string | null
          timestamp?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      user_organization_roles: {
        Row: {
          created_at: string
          granted_at: string
          granted_by: string | null
          id: string
          is_active: boolean
          organization_id: string
          role_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          role_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          role_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organizations: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          is_active: boolean
          joined_at: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          joined_at?: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          joined_at?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_at: string
          granted_by: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          created_at: string
          id: string
          location: string | null
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      inventory_summary: {
        Row: {
          a_grade_stock: number | null
          b_grade_stock: number | null
          c_grade_stock: number | null
          color: string | null
          d_grade_stock: number | null
          defective_stock: number | null
          product_id: string | null
          product_name: string | null
          total_rolls: number | null
          total_stock: number | null
        }
        Relationships: []
      }
      inventory_summary_enhanced: {
        Row: {
          a_grade_details: string[] | null
          a_grade_rolls: number | null
          a_grade_stock: number | null
          b_grade_details: string[] | null
          b_grade_rolls: number | null
          b_grade_stock: number | null
          c_grade_details: string[] | null
          c_grade_rolls: number | null
          c_grade_stock: number | null
          color: string | null
          color_code: string | null
          d_grade_details: string[] | null
          d_grade_rolls: number | null
          d_grade_stock: number | null
          defective_details: string[] | null
          defective_rolls: number | null
          defective_stock: number | null
          pending_in_quantity: number | null
          pending_out_quantity: number | null
          product_id: string | null
          product_name: string | null
          product_status: Database["public"]["Enums"]["product_status"] | null
          stock_thresholds: number | null
          total_rolls: number | null
          total_stock: number | null
        }
        Relationships: []
      }
      users_with_roles: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          phone: string | null
          roles: Json | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_default_organization_roles: {
        Args: { _organization_id: string }
        Returns: undefined
      }
      ensure_user_profile: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      get_current_user_role: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_user_organizations: {
        Args: { _user_id: string }
        Returns: {
          organization_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: {
        Args: { _user_id: string }
        Returns: boolean
      }
      is_organization_owner: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      user_belongs_to_organization: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      user_has_organization_permission: {
        Args: {
          _organization_id: string
          _permission: string
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      fabric_quality: "A" | "B" | "defective" | "C" | "D"
      order_status:
        | "pending"
        | "confirmed"
        | "factory_ordered"
        | "completed"
        | "cancelled"
      payment_status: "unpaid" | "partial_paid" | "paid"
      product_status: "Available" | "Unavailable"
      purchase_order_status:
        | "pending"
        | "confirmed"
        | "partial_arrived"
        | "completed"
        | "cancelled"
        | "partial_received"
      shipping_status: "not_started" | "partial_shipped" | "shipped"
      user_role: "admin" | "sales" | "assistant" | "accounting" | "warehouse"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      fabric_quality: ["A", "B", "defective", "C", "D"],
      order_status: [
        "pending",
        "confirmed",
        "factory_ordered",
        "completed",
        "cancelled",
      ],
      payment_status: ["unpaid", "partial_paid", "paid"],
      product_status: ["Available", "Unavailable"],
      purchase_order_status: [
        "pending",
        "confirmed",
        "partial_arrived",
        "completed",
        "cancelled",
        "partial_received",
      ],
      shipping_status: ["not_started", "partial_shipped", "shipped"],
      user_role: ["admin", "sales", "assistant", "accounting", "warehouse"],
    },
  },
} as const

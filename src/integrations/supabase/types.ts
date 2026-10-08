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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      customers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          fax: string | null
          id: string
          landline_phone: string | null
          name: string
          note: string | null
          organization_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          landline_phone?: string | null
          name: string
          note?: string | null
          organization_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          landline_phone?: string | null
          name?: string
          note?: string | null
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
          fax: string | null
          id: string
          landline_phone: string | null
          name: string
          note: string | null
          organization_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          landline_phone?: string | null
          name: string
          note?: string | null
          organization_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          landline_phone?: string | null
          name?: string
          note?: string | null
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
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
        ]
      }
      query_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          kind: string
          metadata: Json
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "query_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "query_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      query_pending_actions: {
        Row: {
          created_at: string
          decided_at: string | null
          error: string | null
          expires_at: string
          id: string
          organization_id: string
          payload: Json
          result: Json | null
          session_id: string | null
          status: string
          summary: Json
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          error?: string | null
          expires_at?: string
          id?: string
          organization_id: string
          payload: Json
          result?: Json | null
          session_id?: string | null
          status?: string
          summary: Json
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          error?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          result?: Json | null
          session_id?: string | null
          status?: string
          summary?: Json
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "query_pending_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_pending_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "query_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      query_sessions: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          pinned: boolean
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          pinned?: boolean
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          pinned?: boolean
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "query_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      query_traces: {
        Row: {
          attempts: Json
          created_at: string
          error: string | null
          fallback_from: string | null
          id: string
          input_tokens: number
          latency_ms: number
          model: string | null
          organization_id: string
          output_tokens: number
          route: Json | null
          session_id: string | null
          status: string
          steps: Json
          user_id: string
        }
        Insert: {
          attempts?: Json
          created_at?: string
          error?: string | null
          fallback_from?: string | null
          id?: string
          input_tokens?: number
          latency_ms: number
          model?: string | null
          organization_id: string
          output_tokens?: number
          route?: Json | null
          session_id?: string | null
          status: string
          steps?: Json
          user_id: string
        }
        Update: {
          attempts?: Json
          created_at?: string
          error?: string | null
          fallback_from?: string | null
          id?: string
          input_tokens?: number
          latency_ms?: number
          model?: string | null
          organization_id?: string
          output_tokens?: number
          route?: Json | null
          session_id?: string | null
          status?: string
          steps?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "query_traces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_traces_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "query_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      record_audit_logs: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_fields: string[]
          id: string
          new_data: Json | null
          old_data: Json | null
          organization_id: string | null
          parent_id: string | null
          parent_table: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[]
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          parent_id?: string | null
          parent_table?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[]
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          parent_id?: string | null
          parent_table?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_key: string
          role: string
        }
        Insert: {
          permission_key: string
          role: string
        }
        Update: {
          permission_key?: string
          role?: string
        }
        Relationships: []
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
        ]
      }
      user_operation_logs: {
        Row: {
          id: string
          ip_address: unknown
          operation_details: Json | null
          operation_type: string
          operator_id: string
          target_user_id: string | null
          timestamp: string
          user_agent: string | null
        }
        Insert: {
          id?: string
          ip_address?: unknown
          operation_details?: Json | null
          operation_type: string
          operator_id: string
          target_user_id?: string | null
          timestamp?: string
          user_agent?: string | null
        }
        Update: {
          id?: string
          ip_address?: unknown
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
          accepted_at: string | null
          created_at: string
          id: string
          invited_at: string
          invited_by: string | null
          invited_role_id: string | null
          is_active: boolean
          joined_at: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          invited_role_id?: string | null
          is_active?: boolean
          joined_at?: string
          organization_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          invited_role_id?: string | null
          is_active?: boolean
          joined_at?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organizations_invited_role_id_fkey"
            columns: ["invited_role_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
          product_id: string | null
          product_name: string | null
          total_rolls: number | null
          total_stock: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_new_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
          pending_in_quantity: number | null
          pending_out_quantity: number | null
          product_id: string | null
          product_name: string | null
          product_status: Database["public"]["Enums"]["product_status"] | null
          stock_thresholds: number | null
          total_rolls: number | null
          total_stock: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_new_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_organization_invitation: {
        Args: { _organization_id: string }
        Returns: undefined
      }
      add_existing_user_to_organization: {
        Args: { _email: string; _organization_id: string; _role: string }
        Returns: string
      }
      can_inspect_organization: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      complete_user_invitation: {
        Args: {
          _full_name?: string
          _organization_id: string
          _phone?: string
          _role: string
          _user_id: string
        }
        Returns: undefined
      }
      create_default_organization_roles: {
        Args: { _organization_id: string }
        Returns: undefined
      }
      delete_organization: {
        Args: { _confirm_name: string; _organization_id: string }
        Returns: undefined
      }
      ensure_user_profile: { Args: never; Returns: undefined }
      get_my_pending_invitations: {
        Args: never
        Returns: {
          invited_at: string
          is_expired: boolean
          organization_id: string
          organization_name: string
          role_display_name: string
        }[]
      }
      get_organization_member_status: {
        Args: { _organization_id: string }
        Returns: {
          email_confirmed: boolean
          invited_at: string
          is_pending: boolean
          user_id: string
        }[]
      }
      get_user_organizations: {
        Args: { _user_id: string }
        Returns: {
          organization_id: string
        }[]
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_organization_owner: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      order_product_is_purchased: {
        Args: { p_order_id: string; p_product_id: string }
        Returns: boolean
      }
      recompute_order_shipments: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      recompute_purchase_order_receipts: {
        Args: { p_purchase_order_id: string }
        Returns: undefined
      }
      save_inventory_rolls: {
        Args: { p_inventory_id: string; p_rolls: Json }
        Returns: undefined
      }
      save_order_items: {
        Args: { p_items: Json; p_order_id: string }
        Returns: undefined
      }
      save_purchase_order_items: {
        Args: { p_items: Json; p_purchase_order_id: string }
        Returns: undefined
      }
      save_shipping_items: {
        Args: { p_items: Json; p_shipping_id: string }
        Returns: undefined
      }
      set_member_active: {
        Args: { _is_active: boolean; _organization_id: string; _user_id: string }
        Returns: undefined
      }
      set_member_role: {
        Args: { _organization_id: string; _role: string; _user_id: string }
        Returns: undefined
      }
      transfer_organization_ownership: {
        Args: {
          _fallback_role_name?: string
          _new_owner_id: string
          _organization_id: string
        }
        Returns: undefined
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string;
          after_json: Json | null;
          before_json: Json | null;
          command_id: string | null;
          entity_id: string;
          entity_type: string;
          executing_service: string;
          id: string;
          initiating_person_id: string | null;
          occurred_at: string;
          reason: string | null;
        };
        Insert: {
          action: string;
          after_json?: Json | null;
          before_json?: Json | null;
          command_id?: string | null;
          entity_id: string;
          entity_type: string;
          executing_service: string;
          id?: string;
          initiating_person_id?: string | null;
          occurred_at?: string;
          reason?: string | null;
        };
        Update: {
          action?: string;
          after_json?: Json | null;
          before_json?: Json | null;
          command_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          executing_service?: string;
          id?: string;
          initiating_person_id?: string | null;
          occurred_at?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_events_initiating_person_id_fkey';
            columns: ['initiating_person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      commands: {
        Row: {
          actor_person_id: string;
          command_id: string;
          command_type: string;
          created_at: string;
          fingerprint: string;
          result: Json | null;
        };
        Insert: {
          actor_person_id: string;
          command_id: string;
          command_type: string;
          created_at?: string;
          fingerprint: string;
          result?: Json | null;
        };
        Update: {
          actor_person_id?: string;
          command_id?: string;
          command_type?: string;
          created_at?: string;
          fingerprint?: string;
          result?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'commands_actor_person_id_fkey';
            columns: ['actor_person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      customers: {
        Row: {
          address_line1: string;
          address_line2: string | null;
          alternate_contact: string | null;
          contact_notes: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          first_name: string;
          id: string;
          last_name: string;
          phone: string | null;
          postcode: string;
          town: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          address_line1: string;
          address_line2?: string | null;
          alternate_contact?: string | null;
          contact_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          first_name: string;
          id?: string;
          last_name: string;
          phone?: string | null;
          postcode: string;
          town: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          address_line1?: string;
          address_line2?: string | null;
          alternate_contact?: string | null;
          contact_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          first_name?: string;
          id?: string;
          last_name?: string;
          phone?: string | null;
          postcode?: string;
          town?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'customers_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customers_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      jobs: {
        Row: {
          created_at: string;
          created_by: string | null;
          current_contract_gross_pence: number;
          customer_id: string;
          display_name: string;
          electrical_required: boolean;
          finance_route: string;
          id: string;
          job_ref: string;
          lead_source: string | null;
          original_gross_pence: number;
          quote_reference: string | null;
          roof_required: boolean;
          salesperson_id: string;
          scaffold_required: boolean;
          sold_at: string;
          updated_at: string;
          updated_by: string | null;
          valuation_basis: string | null;
          version: number;
          workflow_stage: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          current_contract_gross_pence: number;
          customer_id: string;
          display_name: string;
          electrical_required: boolean;
          finance_route: string;
          id?: string;
          job_ref: string;
          lead_source?: string | null;
          original_gross_pence: number;
          quote_reference?: string | null;
          roof_required: boolean;
          salesperson_id: string;
          scaffold_required: boolean;
          sold_at: string;
          updated_at?: string;
          updated_by?: string | null;
          valuation_basis?: string | null;
          version?: number;
          workflow_stage?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          current_contract_gross_pence?: number;
          customer_id?: string;
          display_name?: string;
          electrical_required?: boolean;
          finance_route?: string;
          id?: string;
          job_ref?: string;
          lead_source?: string | null;
          original_gross_pence?: number;
          quote_reference?: string | null;
          roof_required?: boolean;
          salesperson_id?: string;
          scaffold_required?: boolean;
          sold_at?: string;
          updated_at?: string;
          updated_by?: string | null;
          valuation_basis?: string | null;
          version?: number;
          workflow_stage?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'jobs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_salesperson_id_fkey';
            columns: ['salesperson_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      people: {
        Row: {
          active: boolean;
          auth_user_id: string | null;
          available_from: string | null;
          available_to: string | null;
          capacity_per_day: number | null;
          created_at: string;
          created_by: string | null;
          display_name: string;
          email: string | null;
          id: string;
          legacy_id: string | null;
          notification_email: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          auth_user_id?: string | null;
          available_from?: string | null;
          available_to?: string | null;
          capacity_per_day?: number | null;
          created_at?: string;
          created_by?: string | null;
          display_name: string;
          email?: string | null;
          id?: string;
          legacy_id?: string | null;
          notification_email?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          auth_user_id?: string | null;
          available_from?: string | null;
          available_to?: string | null;
          capacity_per_day?: number | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string;
          email?: string | null;
          id?: string;
          legacy_id?: string | null;
          notification_email?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'people_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'people_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      permissions: {
        Row: {
          code: string;
          created_at: string;
          description: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
        };
        Relationships: [];
      };
      person_roles: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          person_id: string;
          role_code: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          person_id: string;
          role_code: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          person_id?: string;
          role_code?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'person_roles_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'person_roles_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'person_roles_role_code_fkey';
            columns: ['role_code'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'person_roles_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      person_skills: {
        Row: {
          active: boolean;
          certified_until: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          level: string;
          notes: string | null;
          person_id: string;
          skill_code: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          certified_until?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          level?: string;
          notes?: string | null;
          person_id: string;
          skill_code: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          certified_until?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          level?: string;
          notes?: string | null;
          person_id?: string;
          skill_code?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'person_skills_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'person_skills_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'person_skills_skill_code_fkey';
            columns: ['skill_code'];
            isOneToOne: false;
            referencedRelation: 'skills';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'person_skills_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      presales: {
        Row: {
          agreed_price_pence: number;
          catalogue_version: string;
          computed_total_pence: number;
          created_at: string;
          created_by: string | null;
          design: Json;
          design_schema_version: number;
          electrical_notes: string | null;
          id: string;
          job_id: string;
          net_panels: number;
          price_breakdown: Json;
          roof_notes: string | null;
          submitted_at: string;
          surveyor_id: string;
          system_kwp: number;
        };
        Insert: {
          agreed_price_pence: number;
          catalogue_version: string;
          computed_total_pence: number;
          created_at?: string;
          created_by?: string | null;
          design: Json;
          design_schema_version: number;
          electrical_notes?: string | null;
          id?: string;
          job_id: string;
          net_panels: number;
          price_breakdown: Json;
          roof_notes?: string | null;
          submitted_at: string;
          surveyor_id: string;
          system_kwp: number;
        };
        Update: {
          agreed_price_pence?: number;
          catalogue_version?: string;
          computed_total_pence?: number;
          created_at?: string;
          created_by?: string | null;
          design?: Json;
          design_schema_version?: number;
          electrical_notes?: string | null;
          id?: string;
          job_id?: string;
          net_panels?: number;
          price_breakdown?: Json;
          roof_notes?: string | null;
          submitted_at?: string;
          surveyor_id?: string;
          system_kwp?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'presales_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'presales_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: true;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'presales_surveyor_id_fkey';
            columns: ['surveyor_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      role_permissions: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          permission_code: string;
          role_code: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          permission_code: string;
          role_code: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          permission_code?: string;
          role_code?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'role_permissions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'role_permissions_permission_code_fkey';
            columns: ['permission_code'];
            isOneToOne: false;
            referencedRelation: 'permissions';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'role_permissions_role_code_fkey';
            columns: ['role_code'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'role_permissions_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      roles: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          description: string;
          name: string;
          sort_order: number;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          description: string;
          name: string;
          sort_order?: number;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          description?: string;
          name?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      skills: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          name: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          name: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          name?: string;
        };
        Relationships: [];
      };
      task_assignment_rules: {
        Row: {
          active: boolean;
          backup_person_id: string | null;
          created_at: string;
          created_by: string | null;
          eligible_owner_roles: string[];
          id: string;
          notes: string | null;
          owner_person_id: string;
          template_code: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          backup_person_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          eligible_owner_roles: string[];
          id?: string;
          notes?: string | null;
          owner_person_id: string;
          template_code: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          backup_person_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          eligible_owner_roles?: string[];
          id?: string;
          notes?: string | null;
          owner_person_id?: string;
          template_code?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'task_assignment_rules_backup_person_id_fkey';
            columns: ['backup_person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_assignment_rules_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_assignment_rules_owner_person_id_fkey';
            columns: ['owner_person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_assignment_rules_template_code_fkey';
            columns: ['template_code'];
            isOneToOne: false;
            referencedRelation: 'task_templates';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'task_assignment_rules_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      task_templates: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          created_by: string | null;
          default_priority: number;
          due_rule: string;
          guidance: string | null;
          task_group: string;
          template_version: string;
          title: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          created_by?: string | null;
          default_priority?: number;
          due_rule: string;
          guidance?: string | null;
          task_group: string;
          template_version?: string;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          default_priority?: number;
          due_rule?: string;
          guidance?: string | null;
          task_group?: string;
          template_version?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'task_templates_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_templates_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      tasks: {
        Row: {
          assignment_rule_id: string | null;
          backup_id: string | null;
          blocking_reason: string | null;
          completed_at: string | null;
          completed_by: string | null;
          completion_note: string | null;
          created_at: string;
          created_by: string | null;
          created_rule_version: string;
          due_at: string | null;
          evidence_id: string | null;
          id: string;
          instance_key: string;
          job_id: string | null;
          next_followup_at: string | null;
          original_due_at: string | null;
          owner_id: string;
          priority: number;
          related_entity_id: string | null;
          related_entity_type: string | null;
          revision_required: boolean;
          status: string;
          task_group: string;
          template_code: string;
          title: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          assignment_rule_id?: string | null;
          backup_id?: string | null;
          blocking_reason?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          completion_note?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_rule_version: string;
          due_at?: string | null;
          evidence_id?: string | null;
          id?: string;
          instance_key: string;
          job_id?: string | null;
          next_followup_at?: string | null;
          original_due_at?: string | null;
          owner_id: string;
          priority?: number;
          related_entity_id?: string | null;
          related_entity_type?: string | null;
          revision_required?: boolean;
          status?: string;
          task_group: string;
          template_code: string;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          assignment_rule_id?: string | null;
          backup_id?: string | null;
          blocking_reason?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          completion_note?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_rule_version?: string;
          due_at?: string | null;
          evidence_id?: string | null;
          id?: string;
          instance_key?: string;
          job_id?: string | null;
          next_followup_at?: string | null;
          original_due_at?: string | null;
          owner_id?: string;
          priority?: number;
          related_entity_id?: string | null;
          related_entity_type?: string | null;
          revision_required?: boolean;
          status?: string;
          task_group?: string;
          template_code?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_assignment_rule_id_fkey';
            columns: ['assignment_rule_id'];
            isOneToOne: false;
            referencedRelation: 'task_assignment_rules';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_backup_id_fkey';
            columns: ['backup_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_completed_by_fkey';
            columns: ['completed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_template_code_fkey';
            columns: ['template_code'];
            isOneToOne: false;
            referencedRelation: 'task_templates';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'tasks_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_actor: {
        Args: never;
        Returns: {
          display_name: string;
          email: string;
          person_id: string;
          roles: string[];
        }[];
      };
      submit_presale: {
        Args: { p_command_id: string; p_payload: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {}
  },
  public: {
    Enums: {}
  }
} as const;

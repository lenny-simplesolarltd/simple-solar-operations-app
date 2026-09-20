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
      accounting_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          credit_account: string | null;
          debit_account: string | null;
          effective_date: string;
          event_type: string;
          id: string;
          job_id: string;
          net_amount_pence: number;
          policy_version: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source_invoice_ids: string[] | null;
          status: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
          xero_journal_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          credit_account?: string | null;
          debit_account?: string | null;
          effective_date: string;
          event_type: string;
          id?: string;
          job_id: string;
          net_amount_pence: number;
          policy_version: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_invoice_ids?: string[] | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          xero_journal_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          credit_account?: string | null;
          debit_account?: string | null;
          effective_date?: string;
          event_type?: string;
          id?: string;
          job_id?: string;
          net_amount_pence?: number;
          policy_version?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_invoice_ids?: string[] | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          xero_journal_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'accounting_events_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'accounting_events_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'accounting_events_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'accounting_events_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      acknowledgements: {
        Row: {
          acknowledged_revision: number;
          communication_id: string;
          company_id: string;
          created_at: string;
          entity_id: string;
          evidence_id: string | null;
          id: string;
          received_at: string;
          recorded_by: string;
          response: string;
          response_text: string | null;
        };
        Insert: {
          acknowledged_revision: number;
          communication_id: string;
          company_id: string;
          created_at?: string;
          entity_id: string;
          evidence_id?: string | null;
          id?: string;
          received_at: string;
          recorded_by: string;
          response: string;
          response_text?: string | null;
        };
        Update: {
          acknowledged_revision?: number;
          communication_id?: string;
          company_id?: string;
          created_at?: string;
          entity_id?: string;
          evidence_id?: string | null;
          id?: string;
          received_at?: string;
          recorded_by?: string;
          response?: string;
          response_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'acknowledgements_communication_id_fkey';
            columns: ['communication_id'];
            isOneToOne: false;
            referencedRelation: 'communications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acknowledgements_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acknowledgements_evidence_id_fkey';
            columns: ['evidence_id'];
            isOneToOne: false;
            referencedRelation: 'evidence';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acknowledgements_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      allocations: {
        Row: {
          active: boolean;
          calendar_link_id: string | null;
          cancellation_reason: string | null;
          created_at: string;
          created_by: string | null;
          end_at: string | null;
          id: string;
          person_id: string;
          replaced_allocation_id: string | null;
          role: string;
          start_at: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
          work_package_id: string;
        };
        Insert: {
          active?: boolean;
          calendar_link_id?: string | null;
          cancellation_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          end_at?: string | null;
          id?: string;
          person_id: string;
          replaced_allocation_id?: string | null;
          role: string;
          start_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_package_id: string;
        };
        Update: {
          active?: boolean;
          calendar_link_id?: string | null;
          cancellation_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          end_at?: string | null;
          id?: string;
          person_id?: string;
          replaced_allocation_id?: string | null;
          role?: string;
          start_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'allocations_calendar_link_id_fkey';
            columns: ['calendar_link_id'];
            isOneToOne: false;
            referencedRelation: 'calendar_links';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'allocations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'allocations_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'allocations_replaced_allocation_id_fkey';
            columns: ['replaced_allocation_id'];
            isOneToOne: false;
            referencedRelation: 'allocations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'allocations_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'allocations_work_package_id_fkey';
            columns: ['work_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          }
        ];
      };
      archive_index: {
        Row: {
          archive_location: string;
          archived_at: string;
          checksum: string;
          created_at: string;
          id: string;
          job_id: string;
          record_counts: Json;
          restored_at: string | null;
          schema_version: string;
        };
        Insert: {
          archive_location: string;
          archived_at: string;
          checksum: string;
          created_at?: string;
          id?: string;
          job_id: string;
          record_counts: Json;
          restored_at?: string | null;
          schema_version: string;
        };
        Update: {
          archive_location?: string;
          archived_at?: string;
          checksum?: string;
          created_at?: string;
          id?: string;
          job_id?: string;
          record_counts?: Json;
          restored_at?: string | null;
          schema_version?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'archive_index_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          }
        ];
      };
      assistant_conversations: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string | null;
          estimated_tokens: number;
          id: string;
          job_id: string | null;
          last_message_at: string | null;
          last_model: string | null;
          last_prompt_tokens: number | null;
          last_provider: string | null;
          message_count: number;
          person_id: string;
          source_conversation_id: string | null;
          summary: string | null;
          summary_updated_at: string | null;
          title: string | null;
          title_source: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          estimated_tokens?: number;
          id?: string;
          job_id?: string | null;
          last_message_at?: string | null;
          last_model?: string | null;
          last_prompt_tokens?: number | null;
          last_provider?: string | null;
          message_count?: number;
          person_id?: string;
          source_conversation_id?: string | null;
          summary?: string | null;
          summary_updated_at?: string | null;
          title?: string | null;
          title_source?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          estimated_tokens?: number;
          id?: string;
          job_id?: string | null;
          last_message_at?: string | null;
          last_model?: string | null;
          last_prompt_tokens?: number | null;
          last_provider?: string | null;
          message_count?: number;
          person_id?: string;
          source_conversation_id?: string | null;
          summary?: string | null;
          summary_updated_at?: string | null;
          title?: string | null;
          title_source?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'assistant_conversations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assistant_conversations_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assistant_conversations_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assistant_conversations_source_conversation_id_fkey';
            columns: ['source_conversation_id'];
            isOneToOne: false;
            referencedRelation: 'assistant_conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assistant_conversations_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      assistant_messages: {
        Row: {
          content: Json;
          conversation_id: string;
          created_at: string;
          estimated_tokens: number;
          id: string;
          model: string | null;
          page_context: Json | null;
          provider: string | null;
          role: string;
          run_id: string;
          seq: number;
          status: string;
          ui: Json | null;
        };
        Insert: {
          content: Json;
          conversation_id: string;
          created_at?: string;
          estimated_tokens?: number;
          id?: string;
          model?: string | null;
          page_context?: Json | null;
          provider?: string | null;
          role: string;
          run_id: string;
          seq: number;
          status?: string;
          ui?: Json | null;
        };
        Update: {
          content?: Json;
          conversation_id?: string;
          created_at?: string;
          estimated_tokens?: number;
          id?: string;
          model?: string | null;
          page_context?: Json | null;
          provider?: string | null;
          role?: string;
          run_id?: string;
          seq?: number;
          status?: string;
          ui?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'assistant_messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'assistant_conversations';
            referencedColumns: ['id'];
          }
        ];
      };
      assistant_pending_actions: {
        Row: {
          args: Json;
          args_hash: string;
          cancelled_at: string | null;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          expected_version: number | null;
          expires_at: string;
          id: string;
          outcome_code: string | null;
          person_id: string;
          preview: Json;
          status: string;
          thread_id: string;
          tool: string;
        };
        Insert: {
          args: Json;
          args_hash: string;
          cancelled_at?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          expected_version?: number | null;
          expires_at: string;
          id: string;
          outcome_code?: string | null;
          person_id: string;
          preview: Json;
          status?: string;
          thread_id: string;
          tool: string;
        };
        Update: {
          args?: Json;
          args_hash?: string;
          cancelled_at?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          expected_version?: number | null;
          expires_at?: string;
          id?: string;
          outcome_code?: string | null;
          person_id?: string;
          preview?: Json;
          status?: string;
          thread_id?: string;
          tool?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'assistant_pending_actions_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
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
      calendar_links: {
        Row: {
          all_day: boolean;
          allocation_id: string | null;
          calendar_id: string;
          created_at: string;
          created_by: string | null;
          description_snapshot: string | null;
          end_at: string | null;
          entity_revision: number;
          error: string | null;
          event_uid: string | null;
          external_event_id: string | null;
          guest_person_ids: string[] | null;
          id: string;
          job_id: string;
          last_attempt_at: string | null;
          last_success_at: string | null;
          last_synced_revision: number;
          outbox_id: string | null;
          producer: string;
          scaffold_activity_id: string | null;
          start_at: string | null;
          status: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          all_day?: boolean;
          allocation_id?: string | null;
          calendar_id: string;
          created_at?: string;
          created_by?: string | null;
          description_snapshot?: string | null;
          end_at?: string | null;
          entity_revision: number;
          error?: string | null;
          event_uid?: string | null;
          external_event_id?: string | null;
          guest_person_ids?: string[] | null;
          id?: string;
          job_id: string;
          last_attempt_at?: string | null;
          last_success_at?: string | null;
          last_synced_revision?: number;
          outbox_id?: string | null;
          producer: string;
          scaffold_activity_id?: string | null;
          start_at?: string | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          all_day?: boolean;
          allocation_id?: string | null;
          calendar_id?: string;
          created_at?: string;
          created_by?: string | null;
          description_snapshot?: string | null;
          end_at?: string | null;
          entity_revision?: number;
          error?: string | null;
          event_uid?: string | null;
          external_event_id?: string | null;
          guest_person_ids?: string[] | null;
          id?: string;
          job_id?: string;
          last_attempt_at?: string | null;
          last_success_at?: string | null;
          last_synced_revision?: number;
          outbox_id?: string | null;
          producer?: string;
          scaffold_activity_id?: string | null;
          start_at?: string | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'calendar_links_allocation_id_fkey';
            columns: ['allocation_id'];
            isOneToOne: false;
            referencedRelation: 'allocations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calendar_links_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calendar_links_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calendar_links_outbox_id_fkey';
            columns: ['outbox_id'];
            isOneToOne: false;
            referencedRelation: 'outbox';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calendar_links_scaffold_activity_id_fkey';
            columns: ['scaffold_activity_id'];
            isOneToOne: false;
            referencedRelation: 'scaffold_bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calendar_links_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      calls: {
        Row: {
          actual_completion_confirmed: boolean;
          attempted_at: string;
          attempted_by: string;
          contact_id: string | null;
          created_at: string;
          customer_happy: boolean | null;
          id: string;
          job_id: string;
          next_attempt_at: string | null;
          notes: string | null;
          outcome: string;
          person_id: string | null;
          strip_authorised: boolean | null;
          task_id: string | null;
          type: string;
          work_package_id: string | null;
        };
        Insert: {
          actual_completion_confirmed?: boolean;
          attempted_at: string;
          attempted_by: string;
          contact_id?: string | null;
          created_at?: string;
          customer_happy?: boolean | null;
          id?: string;
          job_id: string;
          next_attempt_at?: string | null;
          notes?: string | null;
          outcome: string;
          person_id?: string | null;
          strip_authorised?: boolean | null;
          task_id?: string | null;
          type: string;
          work_package_id?: string | null;
        };
        Update: {
          actual_completion_confirmed?: boolean;
          attempted_at?: string;
          attempted_by?: string;
          contact_id?: string | null;
          created_at?: string;
          customer_happy?: boolean | null;
          id?: string;
          job_id?: string;
          next_attempt_at?: string | null;
          notes?: string | null;
          outcome?: string;
          person_id?: string | null;
          strip_authorised?: boolean | null;
          task_id?: string | null;
          type?: string;
          work_package_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'calls_attempted_by_fkey';
            columns: ['attempted_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_work_package_id_fkey';
            columns: ['work_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          }
        ];
      };
      command_batch_items: {
        Row: {
          attempt_count: number;
          batch_id: string;
          claimed_at: string | null;
          command_id: string;
          command_type: string;
          created_at: string;
          error_code: string | null;
          error_detail: string | null;
          expected_version: number | null;
          id: string;
          next_attempt: string | null;
          outcome: Json | null;
          preflight: Json | null;
          sequence: number;
          settled_at: string | null;
          status: string;
          task_id: string;
        };
        Insert: {
          attempt_count?: number;
          batch_id: string;
          claimed_at?: string | null;
          command_id: string;
          command_type: string;
          created_at?: string;
          error_code?: string | null;
          error_detail?: string | null;
          expected_version?: number | null;
          id?: string;
          next_attempt?: string | null;
          outcome?: Json | null;
          preflight?: Json | null;
          sequence: number;
          settled_at?: string | null;
          status?: string;
          task_id: string;
        };
        Update: {
          attempt_count?: number;
          batch_id?: string;
          claimed_at?: string | null;
          command_id?: string;
          command_type?: string;
          created_at?: string;
          error_code?: string | null;
          error_detail?: string | null;
          expected_version?: number | null;
          id?: string;
          next_attempt?: string | null;
          outcome?: Json | null;
          preflight?: Json | null;
          sequence?: number;
          settled_at?: string | null;
          status?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'command_batch_items_batch_id_fkey';
            columns: ['batch_id'];
            isOneToOne: false;
            referencedRelation: 'command_batches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'command_batch_items_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          }
        ];
      };
      command_batches: {
        Row: {
          actor_person_id: string;
          command_id: string;
          created_at: string;
          finished_at: string | null;
          id: string;
          operation: string;
          payload: Json;
          selector: Json | null;
          source: string;
          started_at: string | null;
          status: string;
          total: number;
        };
        Insert: {
          actor_person_id: string;
          command_id: string;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          operation: string;
          payload?: Json;
          selector?: Json | null;
          source?: string;
          started_at?: string | null;
          status?: string;
          total?: number;
        };
        Update: {
          actor_person_id?: string;
          command_id?: string;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          operation?: string;
          payload?: Json;
          selector?: Json | null;
          source?: string;
          started_at?: string | null;
          status?: string;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'command_batches_actor_person_id_fkey';
            columns: ['actor_person_id'];
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
      commissioning_answers: {
        Row: {
          created_at: string;
          id: string;
          not_applicable_reason: string | null;
          question_key: string;
          submission_id: string;
          value_boolean: boolean | null;
          value_date: string | null;
          value_number: number | null;
          value_text: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          not_applicable_reason?: string | null;
          question_key: string;
          submission_id: string;
          value_boolean?: boolean | null;
          value_date?: string | null;
          value_number?: number | null;
          value_text?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          not_applicable_reason?: string | null;
          question_key?: string;
          submission_id?: string;
          value_boolean?: boolean | null;
          value_date?: string | null;
          value_number?: number | null;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'commissioning_answers_submission_id_fkey';
            columns: ['submission_id'];
            isOneToOne: false;
            referencedRelation: 'commissioning_submissions';
            referencedColumns: ['id'];
          }
        ];
      };
      commissioning_questions: {
        Row: {
          allowed_values: string[] | null;
          created_at: string;
          created_by: string | null;
          data_type: string;
          display_order: number;
          help_text: string | null;
          id: string;
          label: string;
          photo_category: string | null;
          question_key: string;
          required_when: string | null;
          review_rule: string | null;
          template_id: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          allowed_values?: string[] | null;
          created_at?: string;
          created_by?: string | null;
          data_type: string;
          display_order: number;
          help_text?: string | null;
          id?: string;
          label: string;
          photo_category?: string | null;
          question_key: string;
          required_when?: string | null;
          review_rule?: string | null;
          template_id: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          allowed_values?: string[] | null;
          created_at?: string;
          created_by?: string | null;
          data_type?: string;
          display_order?: number;
          help_text?: string | null;
          id?: string;
          label?: string;
          photo_category?: string | null;
          question_key?: string;
          required_when?: string | null;
          review_rule?: string | null;
          template_id?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'commissioning_questions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_questions_template_id_fkey';
            columns: ['template_id'];
            isOneToOne: false;
            referencedRelation: 'commissioning_templates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_questions_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      commissioning_submissions: {
        Row: {
          allocation_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          installer_id: string | null;
          job_id: string;
          office_reference: string | null;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source_system: string;
          status: string;
          submitted_at: string | null;
          supersedes_submission_id: string | null;
          template_version: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
          work_package_id: string;
        };
        Insert: {
          allocation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          installer_id?: string | null;
          job_id: string;
          office_reference?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_system?: string;
          status?: string;
          submitted_at?: string | null;
          supersedes_submission_id?: string | null;
          template_version: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_package_id: string;
        };
        Update: {
          allocation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          installer_id?: string | null;
          job_id?: string;
          office_reference?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_system?: string;
          status?: string;
          submitted_at?: string | null;
          supersedes_submission_id?: string | null;
          template_version?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'commissioning_submissions_allocation_id_fkey';
            columns: ['allocation_id'];
            isOneToOne: false;
            referencedRelation: 'allocations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_submissions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_submissions_installer_id_fkey';
            columns: ['installer_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_submissions_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_submissions_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_submissions_supersedes_submission_id_fkey';
            columns: ['supersedes_submission_id'];
            isOneToOne: false;
            referencedRelation: 'commissioning_submissions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_submissions_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_submissions_work_package_id_fkey';
            columns: ['work_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          }
        ];
      };
      commissioning_templates: {
        Row: {
          active: boolean;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          equipment_type: string;
          id: string;
          template_version: string;
          trade: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          equipment_type: string;
          id?: string;
          template_version: string;
          trade: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          equipment_type?: string;
          id?: string;
          template_version?: string;
          trade?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'commissioning_templates_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_templates_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'commissioning_templates_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      commit_journal: {
        Row: {
          changes_json: Json;
          command_id: string;
          commit_id: string;
          committed_at: string | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          expected_version: number | null;
          id: string;
          prepared_at: string;
          state: string;
        };
        Insert: {
          changes_json: Json;
          command_id: string;
          commit_id: string;
          committed_at?: string | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          expected_version?: number | null;
          id?: string;
          prepared_at: string;
          state: string;
        };
        Update: {
          changes_json?: Json;
          command_id?: string;
          commit_id?: string;
          committed_at?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          expected_version?: number | null;
          id?: string;
          prepared_at?: string;
          state?: string;
        };
        Relationships: [];
      };
      communication_jobs: {
        Row: {
          communication_id: string;
          created_at: string;
          entity_revision: number;
          id: string;
          job_id: string;
          order_id: string | null;
          scaffold_booking_id: string | null;
        };
        Insert: {
          communication_id: string;
          created_at?: string;
          entity_revision: number;
          id?: string;
          job_id: string;
          order_id?: string | null;
          scaffold_booking_id?: string | null;
        };
        Update: {
          communication_id?: string;
          created_at?: string;
          entity_revision?: number;
          id?: string;
          job_id?: string;
          order_id?: string | null;
          scaffold_booking_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_jobs_communication_id_fkey';
            columns: ['communication_id'];
            isOneToOne: false;
            referencedRelation: 'communications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communication_jobs_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communication_jobs_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communication_jobs_scaffold_booking_id_fkey';
            columns: ['scaffold_booking_id'];
            isOneToOne: false;
            referencedRelation: 'scaffold_bookings';
            referencedColumns: ['id'];
          }
        ];
      };
      communications: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          attachment_ids: string[] | null;
          body_snapshot: string | null;
          company_id: string | null;
          covered_week_start: string | null;
          created_at: string;
          created_by: string | null;
          delivery_date: string | null;
          external_message_id: string | null;
          id: string;
          job_id: string | null;
          outbox_id: string | null;
          recipients_snapshot: string;
          revision: number;
          sent_at: string | null;
          status: string;
          subject: string;
          type: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          attachment_ids?: string[] | null;
          body_snapshot?: string | null;
          company_id?: string | null;
          covered_week_start?: string | null;
          created_at?: string;
          created_by?: string | null;
          delivery_date?: string | null;
          external_message_id?: string | null;
          id?: string;
          job_id?: string | null;
          outbox_id?: string | null;
          recipients_snapshot: string;
          revision?: number;
          sent_at?: string | null;
          status?: string;
          subject: string;
          type: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          attachment_ids?: string[] | null;
          body_snapshot?: string | null;
          company_id?: string | null;
          covered_week_start?: string | null;
          created_at?: string;
          created_by?: string | null;
          delivery_date?: string | null;
          external_message_id?: string | null;
          id?: string;
          job_id?: string | null;
          outbox_id?: string | null;
          recipients_snapshot?: string;
          revision?: number;
          sent_at?: string | null;
          status?: string;
          subject?: string;
          type?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'communications_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communications_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communications_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communications_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communications_outbox_id_fkey';
            columns: ['outbox_id'];
            isOneToOne: false;
            referencedRelation: 'outbox';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communications_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      companies: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          delivery_weekday: number | null;
          id: string;
          name: string;
          notes: string | null;
          standard_lead_days: number | null;
          type: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          delivery_weekday?: number | null;
          id?: string;
          name: string;
          notes?: string | null;
          standard_lead_days?: number | null;
          type: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          delivery_weekday?: number | null;
          id?: string;
          name?: string;
          notes?: string | null;
          standard_lead_days?: number | null;
          type?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'companies_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      contacts: {
        Row: {
          active: boolean;
          company_id: string;
          contact_role: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          id: string;
          name: string;
          phone: string | null;
          preferred_channel: string | null;
          updated_at: string;
          updated_by: string | null;
          verified_at: string | null;
          verified_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          company_id: string;
          contact_role?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
          preferred_channel?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          verified_at?: string | null;
          verified_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          company_id?: string;
          contact_role?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
          preferred_channel?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          verified_at?: string | null;
          verified_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'contacts_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_verified_by_fkey';
            columns: ['verified_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      customer_changes: {
        Row: {
          created_at: string;
          field_name: string;
          id: string;
          incoming_value: string | null;
          job_id: string;
          previous_value: string | null;
          reason: string | null;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          resolved_value: string | null;
          source_submission_id: string;
        };
        Insert: {
          created_at?: string;
          field_name: string;
          id?: string;
          incoming_value?: string | null;
          job_id: string;
          previous_value?: string | null;
          reason?: string | null;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          resolved_value?: string | null;
          source_submission_id: string;
        };
        Update: {
          created_at?: string;
          field_name?: string;
          id?: string;
          incoming_value?: string | null;
          job_id?: string;
          previous_value?: string | null;
          reason?: string | null;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          resolved_value?: string | null;
          source_submission_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_changes_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_changes_resolved_by_fkey';
            columns: ['resolved_by'];
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
      deliveries: {
        Row: {
          actual_received_at: string | null;
          created_at: string;
          delivery_note_reference: string | null;
          discrepancy_note: string | null;
          expected_date: string;
          id: string;
          order_id: string;
          receipt_status: string;
          received_by: string | null;
        };
        Insert: {
          actual_received_at?: string | null;
          created_at?: string;
          delivery_note_reference?: string | null;
          discrepancy_note?: string | null;
          expected_date: string;
          id?: string;
          order_id: string;
          receipt_status: string;
          received_by?: string | null;
        };
        Update: {
          actual_received_at?: string | null;
          created_at?: string;
          delivery_note_reference?: string | null;
          discrepancy_note?: string | null;
          expected_date?: string;
          id?: string;
          order_id?: string;
          receipt_status?: string;
          received_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'deliveries_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deliveries_received_by_fkey';
            columns: ['received_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      evidence: {
        Row: {
          attached_at: string | null;
          attached_by: string | null;
          captured_at: string | null;
          captured_by: string | null;
          category: string;
          checksum: string | null;
          client_upload_id: string | null;
          context_id: string | null;
          context_type: string | null;
          created_at: string;
          customer_shareable: boolean;
          display_name: string | null;
          filename: string;
          filing_version: number;
          folder_id: string | null;
          id: string;
          issue_id: string | null;
          job_id: string | null;
          mime_type: string | null;
          original_filename: string | null;
          purged_at: string | null;
          purged_by: string | null;
          received_at: string | null;
          registered_at: string | null;
          scope: string;
          size_bytes: number | null;
          storage_path: string;
          submission_id: string | null;
          task_id: string | null;
          trashed_at: string | null;
          trashed_by: string | null;
          upload_status: string;
          uploaded_by: string | null;
          version: number;
          work_package_id: string | null;
        };
        Insert: {
          attached_at?: string | null;
          attached_by?: string | null;
          captured_at?: string | null;
          captured_by?: string | null;
          category: string;
          checksum?: string | null;
          client_upload_id?: string | null;
          context_id?: string | null;
          context_type?: string | null;
          created_at?: string;
          customer_shareable?: boolean;
          display_name?: string | null;
          filename: string;
          filing_version?: number;
          folder_id?: string | null;
          id?: string;
          issue_id?: string | null;
          job_id?: string | null;
          mime_type?: string | null;
          original_filename?: string | null;
          purged_at?: string | null;
          purged_by?: string | null;
          received_at?: string | null;
          registered_at?: string | null;
          scope?: string;
          size_bytes?: number | null;
          storage_path: string;
          submission_id?: string | null;
          task_id?: string | null;
          trashed_at?: string | null;
          trashed_by?: string | null;
          upload_status: string;
          uploaded_by?: string | null;
          version?: number;
          work_package_id?: string | null;
        };
        Update: {
          attached_at?: string | null;
          attached_by?: string | null;
          captured_at?: string | null;
          captured_by?: string | null;
          category?: string;
          checksum?: string | null;
          client_upload_id?: string | null;
          context_id?: string | null;
          context_type?: string | null;
          created_at?: string;
          customer_shareable?: boolean;
          display_name?: string | null;
          filename?: string;
          filing_version?: number;
          folder_id?: string | null;
          id?: string;
          issue_id?: string | null;
          job_id?: string | null;
          mime_type?: string | null;
          original_filename?: string | null;
          purged_at?: string | null;
          purged_by?: string | null;
          received_at?: string | null;
          registered_at?: string | null;
          scope?: string;
          size_bytes?: number | null;
          storage_path?: string;
          submission_id?: string | null;
          task_id?: string | null;
          trashed_at?: string | null;
          trashed_by?: string | null;
          upload_status?: string;
          uploaded_by?: string | null;
          version?: number;
          work_package_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'evidence_attached_by_fkey';
            columns: ['attached_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_captured_by_fkey';
            columns: ['captured_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_folder_id_fkey';
            columns: ['folder_id'];
            isOneToOne: false;
            referencedRelation: 'file_folders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_issue_id_fkey';
            columns: ['issue_id'];
            isOneToOne: false;
            referencedRelation: 'issues';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_purged_by_fkey';
            columns: ['purged_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_submission_id_fkey';
            columns: ['submission_id'];
            isOneToOne: false;
            referencedRelation: 'commissioning_submissions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_trashed_by_fkey';
            columns: ['trashed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_uploaded_by_fkey';
            columns: ['uploaded_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evidence_work_package_id_fkey';
            columns: ['work_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          }
        ];
      };
      file_folders: {
        Row: {
          created_at: string;
          created_by: string | null;
          depth: number;
          id: string;
          job_id: string | null;
          name: string;
          parent_id: string | null;
          path_ids: string[];
          scope: string;
          trashed_at: string | null;
          trashed_by: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          depth?: number;
          id?: string;
          job_id?: string | null;
          name: string;
          parent_id?: string | null;
          path_ids?: string[];
          scope: string;
          trashed_at?: string | null;
          trashed_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          depth?: number;
          id?: string;
          job_id?: string | null;
          name?: string;
          parent_id?: string | null;
          path_ids?: string[];
          scope?: string;
          trashed_at?: string | null;
          trashed_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'file_folders_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_folders_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_folders_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'file_folders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_folders_trashed_by_fkey';
            columns: ['trashed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_folders_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      finance_plans: {
        Row: {
          accounting_recognition_date: string | null;
          agreed_gross_pence: number;
          balance_pct: number;
          created_at: string;
          created_by: string | null;
          currency: string;
          deposit_pct: number;
          finance_agreement_status: string;
          finance_provider_id: string | null;
          first_installation_date: string | null;
          id: string;
          interim_due_date: string | null;
          interim_pct: number;
          job_id: string;
          operational_earned_date: string | null;
          policy_version: string;
          route: string;
          updated_at: string;
          updated_by: string | null;
          vat_basis: string;
          version: number;
        };
        Insert: {
          accounting_recognition_date?: string | null;
          agreed_gross_pence: number;
          balance_pct?: number;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          deposit_pct?: number;
          finance_agreement_status: string;
          finance_provider_id?: string | null;
          first_installation_date?: string | null;
          id?: string;
          interim_due_date?: string | null;
          interim_pct?: number;
          job_id: string;
          operational_earned_date?: string | null;
          policy_version: string;
          route: string;
          updated_at?: string;
          updated_by?: string | null;
          vat_basis: string;
          version?: number;
        };
        Update: {
          accounting_recognition_date?: string | null;
          agreed_gross_pence?: number;
          balance_pct?: number;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          deposit_pct?: number;
          finance_agreement_status?: string;
          finance_provider_id?: string | null;
          first_installation_date?: string | null;
          id?: string;
          interim_due_date?: string | null;
          interim_pct?: number;
          job_id?: string;
          operational_earned_date?: string | null;
          policy_version?: string;
          route?: string;
          updated_at?: string;
          updated_by?: string | null;
          vat_basis?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'finance_plans_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'finance_plans_finance_provider_id_fkey';
            columns: ['finance_provider_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'finance_plans_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: true;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'finance_plans_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      form_invitations: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          form_id: string;
          id: string;
          job_id: string | null;
          person_id: string | null;
          recipient_label: string | null;
          recipient_type: string;
          revision_id: string;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          submitted_at: string | null;
          token_hash: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          form_id: string;
          id: string;
          job_id?: string | null;
          person_id?: string | null;
          recipient_label?: string | null;
          recipient_type: string;
          revision_id: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          submitted_at?: string | null;
          token_hash: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          form_id?: string;
          id?: string;
          job_id?: string | null;
          person_id?: string | null;
          recipient_label?: string | null;
          recipient_type?: string;
          revision_id?: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          submitted_at?: string | null;
          token_hash?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'form_invitations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_invitations_form_id_fkey';
            columns: ['form_id'];
            isOneToOne: false;
            referencedRelation: 'forms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_invitations_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_invitations_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_invitations_revision_id_fkey';
            columns: ['revision_id'];
            isOneToOne: false;
            referencedRelation: 'form_revisions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_invitations_revoked_by_fkey';
            columns: ['revoked_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_invitations_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      form_revisions: {
        Row: {
          definition: Json;
          description: string | null;
          form_id: string;
          id: string;
          published_at: string;
          published_by: string | null;
          revision_number: number;
          title: string;
        };
        Insert: {
          definition: Json;
          description?: string | null;
          form_id: string;
          id?: string;
          published_at?: string;
          published_by?: string | null;
          revision_number: number;
          title: string;
        };
        Update: {
          definition?: Json;
          description?: string | null;
          form_id?: string;
          id?: string;
          published_at?: string;
          published_by?: string | null;
          revision_number?: number;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'form_revisions_form_id_fkey';
            columns: ['form_id'];
            isOneToOne: false;
            referencedRelation: 'forms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_revisions_published_by_fkey';
            columns: ['published_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      form_submissions: {
        Row: {
          answers: Json;
          form_id: string;
          id: string;
          invitation_id: string;
          revision_id: string;
          submitted_at: string;
        };
        Insert: {
          answers: Json;
          form_id: string;
          id: string;
          invitation_id: string;
          revision_id: string;
          submitted_at?: string;
        };
        Update: {
          answers?: Json;
          form_id?: string;
          id?: string;
          invitation_id?: string;
          revision_id?: string;
          submitted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'form_submissions_form_id_fkey';
            columns: ['form_id'];
            isOneToOne: false;
            referencedRelation: 'forms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_submissions_invitation_id_fkey';
            columns: ['invitation_id'];
            isOneToOne: true;
            referencedRelation: 'form_invitations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_submissions_revision_id_fkey';
            columns: ['revision_id'];
            isOneToOne: false;
            referencedRelation: 'form_revisions';
            referencedColumns: ['id'];
          }
        ];
      };
      forms: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string | null;
          current_revision_id: string | null;
          current_revision_number: number;
          definition: Json;
          description: string | null;
          has_unpublished_changes: boolean;
          id: string;
          job_id: string | null;
          kind: string;
          source_form_id: string | null;
          source_template_id: string | null;
          status: string;
          status_before_archive: string | null;
          title: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_revision_id?: string | null;
          current_revision_number?: number;
          definition?: Json;
          description?: string | null;
          has_unpublished_changes?: boolean;
          id?: string;
          job_id?: string | null;
          kind: string;
          source_form_id?: string | null;
          source_template_id?: string | null;
          status: string;
          status_before_archive?: string | null;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_revision_id?: string | null;
          current_revision_number?: number;
          definition?: Json;
          description?: string | null;
          has_unpublished_changes?: boolean;
          id?: string;
          job_id?: string | null;
          kind?: string;
          source_form_id?: string | null;
          source_template_id?: string | null;
          status?: string;
          status_before_archive?: string | null;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'forms_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forms_current_revision_fkey';
            columns: ['current_revision_id'];
            isOneToOne: false;
            referencedRelation: 'form_revisions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forms_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forms_source_form_id_fkey';
            columns: ['source_form_id'];
            isOneToOne: false;
            referencedRelation: 'forms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forms_source_template_id_fkey';
            columns: ['source_template_id'];
            isOneToOne: false;
            referencedRelation: 'forms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forms_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      ghl_tasks: {
        Row: {
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          evidence_reference: string | null;
          id: string;
          job_id: string;
          opportunity_id: string | null;
          readiness_snapshot: string | null;
          target_pipeline_id: string | null;
          target_stage_id: string | null;
          task_id: string;
          template_id: string | null;
        };
        Insert: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          evidence_reference?: string | null;
          id?: string;
          job_id: string;
          opportunity_id?: string | null;
          readiness_snapshot?: string | null;
          target_pipeline_id?: string | null;
          target_stage_id?: string | null;
          task_id: string;
          template_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          evidence_reference?: string | null;
          id?: string;
          job_id?: string;
          opportunity_id?: string | null;
          readiness_snapshot?: string | null;
          target_pipeline_id?: string | null;
          target_stage_id?: string | null;
          task_id?: string;
          template_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ghl_tasks_completed_by_fkey';
            columns: ['completed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ghl_tasks_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ghl_tasks_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          }
        ];
      };
      handover: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          checklist_version: string;
          communication_id: string | null;
          completeness_status: string;
          created_at: string;
          created_by: string | null;
          generated_file_id: string | null;
          generated_version: number | null;
          id: string;
          job_id: string;
          required_document_types: string[];
          reviewed_at: string | null;
          reviewed_by: string | null;
          sent_at: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          checklist_version: string;
          communication_id?: string | null;
          completeness_status: string;
          created_at?: string;
          created_by?: string | null;
          generated_file_id?: string | null;
          generated_version?: number | null;
          id?: string;
          job_id: string;
          required_document_types: string[];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sent_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          checklist_version?: string;
          communication_id?: string | null;
          completeness_status?: string;
          created_at?: string;
          created_by?: string | null;
          generated_file_id?: string | null;
          generated_version?: number | null;
          id?: string;
          job_id?: string;
          required_document_types?: string[];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sent_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'handover_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'handover_communication_id_fkey';
            columns: ['communication_id'];
            isOneToOne: false;
            referencedRelation: 'communications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'handover_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'handover_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'handover_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'handover_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      health_checks: {
        Row: {
          checked_at: string;
          created_at: string;
          error_code: string | null;
          id: string;
          idempotency_key: string | null;
          integration: string;
          last_success: string | null;
          next_action_task_id: string | null;
          outcome: string;
        };
        Insert: {
          checked_at: string;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          idempotency_key?: string | null;
          integration: string;
          last_success?: string | null;
          next_action_task_id?: string | null;
          outcome: string;
        };
        Update: {
          checked_at?: string;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          idempotency_key?: string | null;
          integration?: string;
          last_success?: string | null;
          next_action_task_id?: string | null;
          outcome?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'health_checks_next_action_task_id_fkey';
            columns: ['next_action_task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          }
        ];
      };
      help_article_revisions: {
        Row: {
          aliases: string[];
          article_id: string;
          audience_roles: string[];
          body: string;
          category: string | null;
          change_note: string | null;
          common_task: boolean;
          created_at: string;
          created_by: string | null;
          event: string;
          id: string;
          keywords: string[];
          related_slugs: string[];
          release_functions: string[];
          revision_number: number;
          routes: string[];
          seed_version: number | null;
          slug: string;
          sort_order: number;
          status: string;
          summary: string;
          title: string;
          tools: string[];
        };
        Insert: {
          aliases: string[];
          article_id: string;
          audience_roles: string[];
          body: string;
          category?: string | null;
          change_note?: string | null;
          common_task: boolean;
          created_at?: string;
          created_by?: string | null;
          event: string;
          id?: string;
          keywords: string[];
          related_slugs: string[];
          release_functions: string[];
          revision_number: number;
          routes: string[];
          seed_version?: number | null;
          slug: string;
          sort_order: number;
          status: string;
          summary: string;
          title: string;
          tools: string[];
        };
        Update: {
          aliases?: string[];
          article_id?: string;
          audience_roles?: string[];
          body?: string;
          category?: string | null;
          change_note?: string | null;
          common_task?: boolean;
          created_at?: string;
          created_by?: string | null;
          event?: string;
          id?: string;
          keywords?: string[];
          related_slugs?: string[];
          release_functions?: string[];
          revision_number?: number;
          routes?: string[];
          seed_version?: number | null;
          slug?: string;
          sort_order?: number;
          status?: string;
          summary?: string;
          title?: string;
          tools?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'help_article_revisions_article_id_fkey';
            columns: ['article_id'];
            isOneToOne: false;
            referencedRelation: 'help_articles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'help_article_revisions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      help_articles: {
        Row: {
          aliases: string[];
          archived_at: string | null;
          archived_by: string | null;
          audience_roles: string[];
          body: string;
          category: string | null;
          common_task: boolean;
          created_at: string;
          created_by: string | null;
          has_unpublished_changes: boolean;
          id: string;
          keywords: string[];
          published_at: string | null;
          published_by: string | null;
          published_revision_id: string | null;
          published_revision_number: number | null;
          related_slugs: string[];
          release_functions: string[];
          review_due_at: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          routes: string[];
          seed_update_available: number | null;
          seed_version: number | null;
          slug: string;
          sort_order: number;
          status: string;
          summary: string;
          title: string;
          tools: string[];
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          aliases?: string[];
          archived_at?: string | null;
          archived_by?: string | null;
          audience_roles?: string[];
          body?: string;
          category?: string | null;
          common_task?: boolean;
          created_at?: string;
          created_by?: string | null;
          has_unpublished_changes?: boolean;
          id?: string;
          keywords?: string[];
          published_at?: string | null;
          published_by?: string | null;
          published_revision_id?: string | null;
          published_revision_number?: number | null;
          related_slugs?: string[];
          release_functions?: string[];
          review_due_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          routes?: string[];
          seed_update_available?: number | null;
          seed_version?: number | null;
          slug: string;
          sort_order?: number;
          status?: string;
          summary?: string;
          title: string;
          tools?: string[];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          aliases?: string[];
          archived_at?: string | null;
          archived_by?: string | null;
          audience_roles?: string[];
          body?: string;
          category?: string | null;
          common_task?: boolean;
          created_at?: string;
          created_by?: string | null;
          has_unpublished_changes?: boolean;
          id?: string;
          keywords?: string[];
          published_at?: string | null;
          published_by?: string | null;
          published_revision_id?: string | null;
          published_revision_number?: number | null;
          related_slugs?: string[];
          release_functions?: string[];
          review_due_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          routes?: string[];
          seed_update_available?: number | null;
          seed_version?: number | null;
          slug?: string;
          sort_order?: number;
          status?: string;
          summary?: string;
          title?: string;
          tools?: string[];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'help_articles_archived_by_fkey';
            columns: ['archived_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'help_articles_category_fkey';
            columns: ['category'];
            isOneToOne: false;
            referencedRelation: 'help_categories';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'help_articles_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'help_articles_published_by_fkey';
            columns: ['published_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'help_articles_published_revision_fkey';
            columns: ['published_revision_id'];
            isOneToOne: false;
            referencedRelation: 'help_article_revisions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'help_articles_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'help_articles_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      help_categories: {
        Row: {
          code: string;
          description: string;
          icon: string;
          sort_order: number;
          title: string;
        };
        Insert: {
          code: string;
          description: string;
          icon: string;
          sort_order: number;
          title: string;
        };
        Update: {
          code?: string;
          description?: string;
          icon?: string;
          sort_order?: number;
          title?: string;
        };
        Relationships: [];
      };
      historical_job_people: {
        Row: {
          created_at: string;
          id: string;
          job_id: string;
          match_kind: string;
          person_id: string | null;
          role: string;
          source_column: number | null;
          source_value: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          job_id: string;
          match_kind: string;
          person_id?: string | null;
          role: string;
          source_column?: number | null;
          source_value: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          job_id?: string;
          match_kind?: string;
          person_id?: string | null;
          role?: string;
          source_column?: number | null;
          source_value?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'historical_job_people_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'historical_job_people_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      holidays: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string;
          id: string;
          local_date: string;
          office_closed: boolean;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description: string;
          id?: string;
          local_date: string;
          office_closed?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          local_date?: string;
          office_closed?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'holidays_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'holidays_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      intake: {
        Row: {
          created_at: string;
          form_id: string;
          form_type: string;
          id: string;
          intake_id: string;
          job_id: string | null;
          payload_hash: string | null;
          processed_at: string | null;
          processing_status: string;
          raw_payload_json: Json | null;
          received_at: string;
          retry_count: number;
          source_revision: string | null;
          submission_id: string;
          validation_errors: string | null;
        };
        Insert: {
          created_at?: string;
          form_id: string;
          form_type: string;
          id?: string;
          intake_id: string;
          job_id?: string | null;
          payload_hash?: string | null;
          processed_at?: string | null;
          processing_status?: string;
          raw_payload_json?: Json | null;
          received_at: string;
          retry_count?: number;
          source_revision?: string | null;
          submission_id: string;
          validation_errors?: string | null;
        };
        Update: {
          created_at?: string;
          form_id?: string;
          form_type?: string;
          id?: string;
          intake_id?: string;
          job_id?: string | null;
          payload_hash?: string | null;
          processed_at?: string | null;
          processing_status?: string;
          raw_payload_json?: Json | null;
          received_at?: string;
          retry_count?: number;
          source_revision?: string | null;
          submission_id?: string;
          validation_errors?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'intake_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          }
        ];
      };
      invoice_stages: {
        Row: {
          amount_net_pence: number;
          cancelled_at: string | null;
          created_at: string;
          created_by: string | null;
          due_date: string | null;
          gross_pence: number;
          id: string;
          invoice_number: string | null;
          job_id: string;
          last_synced_at: string | null;
          reference: string | null;
          request_id: string | null;
          sent_at: string | null;
          source_status: string | null;
          stage: string;
          status: string;
          updated_at: string;
          updated_by: string | null;
          vat_pence: number;
          version: number;
          xero_contact_id: string | null;
          xero_invoice_id: string | null;
        };
        Insert: {
          amount_net_pence: number;
          cancelled_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_date?: string | null;
          gross_pence: number;
          id?: string;
          invoice_number?: string | null;
          job_id: string;
          last_synced_at?: string | null;
          reference?: string | null;
          request_id?: string | null;
          sent_at?: string | null;
          source_status?: string | null;
          stage: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          vat_pence: number;
          version?: number;
          xero_contact_id?: string | null;
          xero_invoice_id?: string | null;
        };
        Update: {
          amount_net_pence?: number;
          cancelled_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_date?: string | null;
          gross_pence?: number;
          id?: string;
          invoice_number?: string | null;
          job_id?: string;
          last_synced_at?: string | null;
          reference?: string | null;
          request_id?: string | null;
          sent_at?: string | null;
          source_status?: string | null;
          stage?: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          vat_pence?: number;
          version?: number;
          xero_contact_id?: string | null;
          xero_invoice_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_stages_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_stages_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_stages_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      issue_events: {
        Row: {
          actor: string;
          created_at: string;
          event_type: string;
          evidence_id: string | null;
          id: string;
          issue_id: string;
          new_status: string | null;
          note: string | null;
          occurred_at: string;
          previous_status: string | null;
        };
        Insert: {
          actor: string;
          created_at?: string;
          event_type: string;
          evidence_id?: string | null;
          id?: string;
          issue_id: string;
          new_status?: string | null;
          note?: string | null;
          occurred_at: string;
          previous_status?: string | null;
        };
        Update: {
          actor?: string;
          created_at?: string;
          event_type?: string;
          evidence_id?: string | null;
          id?: string;
          issue_id?: string;
          new_status?: string | null;
          note?: string | null;
          occurred_at?: string;
          previous_status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'issue_events_actor_fkey';
            columns: ['actor'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issue_events_evidence_id_fkey';
            columns: ['evidence_id'];
            isOneToOne: false;
            referencedRelation: 'evidence';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issue_events_issue_id_fkey';
            columns: ['issue_id'];
            isOneToOne: false;
            referencedRelation: 'issues';
            referencedColumns: ['id'];
          }
        ];
      };
      issues: {
        Row: {
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          approved_value_pence: number | null;
          blocks_completion: boolean;
          blocks_strip: boolean;
          category: string;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          created_by: string | null;
          customer_resolution_confirmed: boolean | null;
          description: string;
          due_at: string | null;
          estimated_value_pence: number | null;
          evidence_folder_id: string | null;
          id: string;
          job_id: string;
          linked_return_package_id: string | null;
          next_followup_at: string | null;
          office_owner_id: string;
          raised_at: string;
          raised_by: string;
          resolution: string | null;
          resolved_at: string | null;
          responsible_company_id: string | null;
          responsible_person_id: string | null;
          severity: string;
          status: string;
          type: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
          work_package_id: string | null;
        };
        Insert: {
          approval_status: string;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_value_pence?: number | null;
          blocks_completion?: boolean;
          blocks_strip?: boolean;
          category: string;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_resolution_confirmed?: boolean | null;
          description: string;
          due_at?: string | null;
          estimated_value_pence?: number | null;
          evidence_folder_id?: string | null;
          id?: string;
          job_id: string;
          linked_return_package_id?: string | null;
          next_followup_at?: string | null;
          office_owner_id: string;
          raised_at: string;
          raised_by: string;
          resolution?: string | null;
          resolved_at?: string | null;
          responsible_company_id?: string | null;
          responsible_person_id?: string | null;
          severity: string;
          status?: string;
          type: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_package_id?: string | null;
        };
        Update: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_value_pence?: number | null;
          blocks_completion?: boolean;
          blocks_strip?: boolean;
          category?: string;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_resolution_confirmed?: boolean | null;
          description?: string;
          due_at?: string | null;
          estimated_value_pence?: number | null;
          evidence_folder_id?: string | null;
          id?: string;
          job_id?: string;
          linked_return_package_id?: string | null;
          next_followup_at?: string | null;
          office_owner_id?: string;
          raised_at?: string;
          raised_by?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          responsible_company_id?: string | null;
          responsible_person_id?: string | null;
          severity?: string;
          status?: string;
          type?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_package_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'issues_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_linked_return_package_id_fkey';
            columns: ['linked_return_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_office_owner_id_fkey';
            columns: ['office_owner_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_raised_by_fkey';
            columns: ['raised_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_responsible_company_id_fkey';
            columns: ['responsible_company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_responsible_person_id_fkey';
            columns: ['responsible_person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_work_package_id_fkey';
            columns: ['work_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          }
        ];
      };
      job_costs: {
        Row: {
          accounting_date: string | null;
          amount_net_pence: number;
          category: string;
          created_at: string;
          created_by: string | null;
          id: string;
          job_id: string;
          policy_version: string;
          source_document_id: string | null;
          status: string;
          supplier_id: string | null;
          updated_at: string;
          updated_by: string | null;
          vat_pence: number;
          version: number;
        };
        Insert: {
          accounting_date?: string | null;
          amount_net_pence: number;
          category: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          job_id: string;
          policy_version: string;
          source_document_id?: string | null;
          status: string;
          supplier_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          vat_pence?: number;
          version?: number;
        };
        Update: {
          accounting_date?: string | null;
          amount_net_pence?: number;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          job_id?: string;
          policy_version?: string;
          source_document_id?: string | null;
          status?: string;
          supplier_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          vat_pence?: number;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'job_costs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_costs_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_costs_supplier_id_fkey';
            columns: ['supplier_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_costs_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      job_equipment: {
        Row: {
          commissioning_submission_id: string | null;
          created_at: string;
          created_by: string | null;
          equipment_type: string;
          id: string;
          installed_location: string | null;
          installed_product_id: string | null;
          job_id: string;
          planned_location: string | null;
          planned_product_id: string | null;
          quantity: number;
          serial_number: string | null;
          technical_review_status: string;
          updated_at: string;
          updated_by: string | null;
          variation_id: string | null;
          version: number;
          work_package_id: string;
        };
        Insert: {
          commissioning_submission_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          equipment_type: string;
          id?: string;
          installed_location?: string | null;
          installed_product_id?: string | null;
          job_id: string;
          planned_location?: string | null;
          planned_product_id?: string | null;
          quantity: number;
          serial_number?: string | null;
          technical_review_status: string;
          updated_at?: string;
          updated_by?: string | null;
          variation_id?: string | null;
          version?: number;
          work_package_id: string;
        };
        Update: {
          commissioning_submission_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          equipment_type?: string;
          id?: string;
          installed_location?: string | null;
          installed_product_id?: string | null;
          job_id?: string;
          planned_location?: string | null;
          planned_product_id?: string | null;
          quantity?: number;
          serial_number?: string | null;
          technical_review_status?: string;
          updated_at?: string;
          updated_by?: string | null;
          variation_id?: string | null;
          version?: number;
          work_package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_equipment_commissioning_submission_id_fkey';
            columns: ['commissioning_submission_id'];
            isOneToOne: false;
            referencedRelation: 'commissioning_submissions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_equipment_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_equipment_installed_product_id_fkey';
            columns: ['installed_product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_equipment_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_equipment_planned_product_id_fkey';
            columns: ['planned_product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_equipment_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_equipment_variation_id_fkey';
            columns: ['variation_id'];
            isOneToOne: false;
            referencedRelation: 'issues';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_equipment_work_package_id_fkey';
            columns: ['work_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          }
        ];
      };
      jobs: {
        Row: {
          account_policy_version: string | null;
          approved_change_pence: number | null;
          archived_at: string | null;
          booking_approved_at: string | null;
          booking_approved_by: string | null;
          booking_submission_id: string | null;
          cancellation_at: string | null;
          cancellation_by: string | null;
          cancellation_reason: string | null;
          contract_evidence_id: string | null;
          contract_id: string | null;
          contract_signed_at: string | null;
          contract_status: string;
          created_at: string;
          created_by: string | null;
          current_contract_gross_pence: number | null;
          customer_details_verified_at: string | null;
          customer_details_verified_by: string | null;
          customer_happy_at: string | null;
          customer_happy_by: string | null;
          customer_id: string;
          deposit_bank_confirmed_at: string | null;
          deposit_bank_confirmed_by: string | null;
          deposit_bank_reference: string | null;
          display_name: string;
          electrical_required: boolean;
          finance_route: string | null;
          financial_status: string;
          handover_status: string;
          id: string;
          job_ref: string;
          lead_source: string | null;
          next_action_at: string | null;
          operational_complete_at: string | null;
          operational_complete_by: string | null;
          original_gross_pence: number | null;
          quote_reference: string | null;
          record_class: string;
          roof_required: boolean;
          salesperson_id: string | null;
          scaffold_required: boolean;
          sold_at: string;
          sold_booking_match_status: string;
          source_reference: string | null;
          source_system: string | null;
          updated_at: string;
          updated_by: string | null;
          valuation_basis: string | null;
          version: number;
          workflow_stage: string;
        };
        Insert: {
          account_policy_version?: string | null;
          approved_change_pence?: number | null;
          archived_at?: string | null;
          booking_approved_at?: string | null;
          booking_approved_by?: string | null;
          booking_submission_id?: string | null;
          cancellation_at?: string | null;
          cancellation_by?: string | null;
          cancellation_reason?: string | null;
          contract_evidence_id?: string | null;
          contract_id?: string | null;
          contract_signed_at?: string | null;
          contract_status?: string;
          created_at?: string;
          created_by?: string | null;
          current_contract_gross_pence?: number | null;
          customer_details_verified_at?: string | null;
          customer_details_verified_by?: string | null;
          customer_happy_at?: string | null;
          customer_happy_by?: string | null;
          customer_id: string;
          deposit_bank_confirmed_at?: string | null;
          deposit_bank_confirmed_by?: string | null;
          deposit_bank_reference?: string | null;
          display_name: string;
          electrical_required: boolean;
          finance_route?: string | null;
          financial_status?: string;
          handover_status?: string;
          id?: string;
          job_ref: string;
          lead_source?: string | null;
          next_action_at?: string | null;
          operational_complete_at?: string | null;
          operational_complete_by?: string | null;
          original_gross_pence?: number | null;
          quote_reference?: string | null;
          record_class?: string;
          roof_required: boolean;
          salesperson_id?: string | null;
          scaffold_required: boolean;
          sold_at: string;
          sold_booking_match_status?: string;
          source_reference?: string | null;
          source_system?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valuation_basis?: string | null;
          version?: number;
          workflow_stage?: string;
        };
        Update: {
          account_policy_version?: string | null;
          approved_change_pence?: number | null;
          archived_at?: string | null;
          booking_approved_at?: string | null;
          booking_approved_by?: string | null;
          booking_submission_id?: string | null;
          cancellation_at?: string | null;
          cancellation_by?: string | null;
          cancellation_reason?: string | null;
          contract_evidence_id?: string | null;
          contract_id?: string | null;
          contract_signed_at?: string | null;
          contract_status?: string;
          created_at?: string;
          created_by?: string | null;
          current_contract_gross_pence?: number | null;
          customer_details_verified_at?: string | null;
          customer_details_verified_by?: string | null;
          customer_happy_at?: string | null;
          customer_happy_by?: string | null;
          customer_id?: string;
          deposit_bank_confirmed_at?: string | null;
          deposit_bank_confirmed_by?: string | null;
          deposit_bank_reference?: string | null;
          display_name?: string;
          electrical_required?: boolean;
          finance_route?: string | null;
          financial_status?: string;
          handover_status?: string;
          id?: string;
          job_ref?: string;
          lead_source?: string | null;
          next_action_at?: string | null;
          operational_complete_at?: string | null;
          operational_complete_by?: string | null;
          original_gross_pence?: number | null;
          quote_reference?: string | null;
          record_class?: string;
          roof_required?: boolean;
          salesperson_id?: string | null;
          scaffold_required?: boolean;
          sold_at?: string;
          sold_booking_match_status?: string;
          source_reference?: string | null;
          source_system?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valuation_basis?: string | null;
          version?: number;
          workflow_stage?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'jobs_booking_approved_by_fkey';
            columns: ['booking_approved_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_booking_submission_id_fkey';
            columns: ['booking_submission_id'];
            isOneToOne: false;
            referencedRelation: 'intake';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_cancellation_by_fkey';
            columns: ['cancellation_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_contract_evidence_id_fkey';
            columns: ['contract_evidence_id'];
            isOneToOne: false;
            referencedRelation: 'evidence';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_customer_details_verified_by_fkey';
            columns: ['customer_details_verified_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_customer_happy_by_fkey';
            columns: ['customer_happy_by'];
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
            foreignKeyName: 'jobs_deposit_bank_confirmed_by_fkey';
            columns: ['deposit_bank_confirmed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jobs_operational_complete_by_fkey';
            columns: ['operational_complete_by'];
            isOneToOne: false;
            referencedRelation: 'people';
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
      manual_bank_checks: {
        Row: {
          amount_pence: number;
          checked_at: string;
          checked_by: string;
          command_id: string | null;
          created_at: string;
          evidence_reference: string | null;
          id: string;
          job_id: string;
          outcome: string;
          stage: string;
        };
        Insert: {
          amount_pence: number;
          checked_at: string;
          checked_by: string;
          command_id?: string | null;
          created_at?: string;
          evidence_reference?: string | null;
          id?: string;
          job_id: string;
          outcome: string;
          stage: string;
        };
        Update: {
          amount_pence?: number;
          checked_at?: string;
          checked_by?: string;
          command_id?: string | null;
          created_at?: string;
          evidence_reference?: string | null;
          id?: string;
          job_id?: string;
          outcome?: string;
          stage?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'manual_bank_checks_checked_by_fkey';
            columns: ['checked_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'manual_bank_checks_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          }
        ];
      };
      mapping_rules: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          disposition: string;
          effective_from: string;
          form_id: string;
          id: string;
          mapping_version: string;
          owner: string;
          question_id: string;
          required_when: string | null;
          source_label: string;
          target_field: string;
          target_table: string;
          transform: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          disposition: string;
          effective_from: string;
          form_id: string;
          id?: string;
          mapping_version: string;
          owner: string;
          question_id: string;
          required_when?: string | null;
          source_label: string;
          target_field: string;
          target_table: string;
          transform?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          disposition?: string;
          effective_from?: string;
          form_id?: string;
          id?: string;
          mapping_version?: string;
          owner?: string;
          question_id?: string;
          required_when?: string | null;
          source_label?: string;
          target_field?: string;
          target_table?: string;
          transform?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'mapping_rules_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mapping_rules_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      materials: {
        Row: {
          already_ordered_reference: string | null;
          cancelled_quantity: number;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          job_id: string;
          merchant_id: string | null;
          need_by_date: string | null;
          notes: string | null;
          order_line_id: string | null;
          product_id: string | null;
          required_quantity: number;
          revision: number;
          source: string;
          unit: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
          work_package_id: string | null;
        };
        Insert: {
          already_ordered_reference?: string | null;
          cancelled_quantity?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          job_id: string;
          merchant_id?: string | null;
          need_by_date?: string | null;
          notes?: string | null;
          order_line_id?: string | null;
          product_id?: string | null;
          required_quantity: number;
          revision?: number;
          source: string;
          unit: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_package_id?: string | null;
        };
        Update: {
          already_ordered_reference?: string | null;
          cancelled_quantity?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          job_id?: string;
          merchant_id?: string | null;
          need_by_date?: string | null;
          notes?: string | null;
          order_line_id?: string | null;
          product_id?: string | null;
          required_quantity?: number;
          revision?: number;
          source?: string;
          unit?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_package_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'materials_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'materials_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'materials_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'materials_order_line_id_fkey';
            columns: ['order_line_id'];
            isOneToOne: false;
            referencedRelation: 'order_lines';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'materials_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'materials_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'materials_work_package_id_fkey';
            columns: ['work_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          }
        ];
      };
      operational_evidence: {
        Row: {
          command_id: string | null;
          evidence_reference: string;
          executing_service: string;
          id: string;
          kind: string;
          method: string;
          notes: string | null;
          outcome: string;
          performed_at: string;
          recorded_at: string;
          recorded_by: string | null;
          source: string;
          subject_at: string | null;
        };
        Insert: {
          command_id?: string | null;
          evidence_reference: string;
          executing_service: string;
          id?: string;
          kind: string;
          method: string;
          notes?: string | null;
          outcome: string;
          performed_at: string;
          recorded_at?: string;
          recorded_by?: string | null;
          source: string;
          subject_at?: string | null;
        };
        Update: {
          command_id?: string | null;
          evidence_reference?: string;
          executing_service?: string;
          id?: string;
          kind?: string;
          method?: string;
          notes?: string | null;
          outcome?: string;
          performed_at?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          source?: string;
          subject_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'operational_evidence_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      order_lines: {
        Row: {
          cancelled_quantity: number;
          created_at: string;
          description_snapshot: string;
          id: string;
          material_id: string | null;
          order_id: string;
          product_id: string | null;
          quantity: number;
          unit: string;
          unit_net_cost_pence: number | null;
          vat_code: string | null;
        };
        Insert: {
          cancelled_quantity?: number;
          created_at?: string;
          description_snapshot: string;
          id?: string;
          material_id?: string | null;
          order_id: string;
          product_id?: string | null;
          quantity: number;
          unit: string;
          unit_net_cost_pence?: number | null;
          vat_code?: string | null;
        };
        Update: {
          cancelled_quantity?: number;
          created_at?: string;
          description_snapshot?: string;
          id?: string;
          material_id?: string | null;
          order_id?: string;
          product_id?: string | null;
          quantity?: number;
          unit?: string;
          unit_net_cost_pence?: number | null;
          vat_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_lines_material_id_fkey';
            columns: ['material_id'];
            isOneToOne: false;
            referencedRelation: 'materials';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_lines_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_lines_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          }
        ];
      };
      orders: {
        Row: {
          confirmed_at: string | null;
          confirmed_by: string | null;
          confirmed_revision: number | null;
          created_at: string;
          created_by: string | null;
          delivery_address: string | null;
          delivery_location_id: string | null;
          id: string;
          job_id: string;
          merchant_id: string;
          requested_delivery_date: string;
          revision: number;
          sent_message_id: string | null;
          status: string;
          supplier_reference: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
          work_type: string;
        };
        Insert: {
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          confirmed_revision?: number | null;
          created_at?: string;
          created_by?: string | null;
          delivery_address?: string | null;
          delivery_location_id?: string | null;
          id?: string;
          job_id: string;
          merchant_id: string;
          requested_delivery_date: string;
          revision?: number;
          sent_message_id?: string | null;
          status?: string;
          supplier_reference?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_type: string;
        };
        Update: {
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          confirmed_revision?: number | null;
          created_at?: string;
          created_by?: string | null;
          delivery_address?: string | null;
          delivery_location_id?: string | null;
          id?: string;
          job_id?: string;
          merchant_id?: string;
          requested_delivery_date?: string;
          revision?: number;
          sent_message_id?: string | null;
          status?: string;
          supplier_reference?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          work_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_confirmed_by_fkey';
            columns: ['confirmed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_delivery_location_id_fkey';
            columns: ['delivery_location_id'];
            isOneToOne: false;
            referencedRelation: 'stock_locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_sent_message_id_fkey';
            columns: ['sent_message_id'];
            isOneToOne: false;
            referencedRelation: 'communications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      outbox: {
        Row: {
          action_type: string;
          attempt_count: number;
          claimed_at: string | null;
          correlation_id: string | null;
          created_at: string;
          external_id: string | null;
          id: string;
          idempotency_key: string;
          job_revision: number | null;
          next_attempt: string | null;
          payload_hash: string;
          response_summary: string | null;
          status: string;
          target: string;
        };
        Insert: {
          action_type: string;
          attempt_count?: number;
          claimed_at?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          external_id?: string | null;
          id?: string;
          idempotency_key: string;
          job_revision?: number | null;
          next_attempt?: string | null;
          payload_hash: string;
          response_summary?: string | null;
          status?: string;
          target: string;
        };
        Update: {
          action_type?: string;
          attempt_count?: number;
          claimed_at?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          external_id?: string | null;
          id?: string;
          idempotency_key?: string;
          job_revision?: number | null;
          next_attempt?: string | null;
          payload_hash?: string;
          response_summary?: string | null;
          status?: string;
          target?: string;
        };
        Relationships: [];
      };
      panel_use: {
        Row: {
          broken_quantity: number;
          created_at: string;
          defective_quantity: number;
          id: string;
          installed_quantity: number;
          issued_quantity: number;
          job_id: string;
          photos: string[] | null;
          product_id: string;
          reported_at: string;
          reported_by: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          roof_package_id: string;
          roofer_notes: string | null;
          unused_quantity: number;
        };
        Insert: {
          broken_quantity: number;
          created_at?: string;
          defective_quantity: number;
          id?: string;
          installed_quantity: number;
          issued_quantity: number;
          job_id: string;
          photos?: string[] | null;
          product_id: string;
          reported_at: string;
          reported_by: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          roof_package_id: string;
          roofer_notes?: string | null;
          unused_quantity: number;
        };
        Update: {
          broken_quantity?: number;
          created_at?: string;
          defective_quantity?: number;
          id?: string;
          installed_quantity?: number;
          issued_quantity?: number;
          job_id?: string;
          photos?: string[] | null;
          product_id?: string;
          reported_at?: string;
          reported_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          roof_package_id?: string;
          roofer_notes?: string | null;
          unused_quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'panel_use_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'panel_use_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'panel_use_reported_by_fkey';
            columns: ['reported_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'panel_use_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'panel_use_roof_package_id_fkey';
            columns: ['roof_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          }
        ];
      };
      payments: {
        Row: {
          amount_pence: number;
          created_at: string;
          id: string;
          invoice_stage_id: string;
          last_synced_at: string | null;
          payment_date: string;
          reconciliation_evidence: string | null;
          status: string;
          xero_payment_id: string | null;
        };
        Insert: {
          amount_pence: number;
          created_at?: string;
          id?: string;
          invoice_stage_id: string;
          last_synced_at?: string | null;
          payment_date: string;
          reconciliation_evidence?: string | null;
          status: string;
          xero_payment_id?: string | null;
        };
        Update: {
          amount_pence?: number;
          created_at?: string;
          id?: string;
          invoice_stage_id?: string;
          last_synced_at?: string | null;
          payment_date?: string;
          reconciliation_evidence?: string | null;
          status?: string;
          xero_payment_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_invoice_stage_id_fkey';
            columns: ['invoice_stage_id'];
            isOneToOne: false;
            referencedRelation: 'invoice_stages';
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
      person_availability: {
        Row: {
          active: boolean;
          approved_by: string | null;
          created_at: string;
          created_by: string | null;
          from_date: string;
          id: string;
          person_id: string;
          reason: string | null;
          to_date: string | null;
          type: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          from_date: string;
          id?: string;
          person_id: string;
          reason?: string | null;
          to_date?: string | null;
          type: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          from_date?: string;
          id?: string;
          person_id?: string;
          reason?: string | null;
          to_date?: string | null;
          type?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'person_availability_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'person_availability_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'person_availability_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'person_availability_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
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
      products: {
        Row: {
          active: boolean;
          category: string;
          created_at: string;
          created_by: string | null;
          default_supplier_id: string | null;
          id: string;
          manufacturer: string | null;
          model: string | null;
          name: string;
          sku: string;
          standard_lead_days: number | null;
          stock_tracked: boolean;
          unit: string;
          unit_cost_pence: number | null;
          unit_precision: number;
          updated_at: string;
          updated_by: string | null;
          version: number;
          wattage: number | null;
        };
        Insert: {
          active?: boolean;
          category: string;
          created_at?: string;
          created_by?: string | null;
          default_supplier_id?: string | null;
          id?: string;
          manufacturer?: string | null;
          model?: string | null;
          name: string;
          sku: string;
          standard_lead_days?: number | null;
          stock_tracked: boolean;
          unit: string;
          unit_cost_pence?: number | null;
          unit_precision?: number;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          wattage?: number | null;
        };
        Update: {
          active?: boolean;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          default_supplier_id?: string | null;
          id?: string;
          manufacturer?: string | null;
          model?: string | null;
          name?: string;
          sku?: string;
          standard_lead_days?: number | null;
          stock_tracked?: boolean;
          unit?: string;
          unit_cost_pence?: number | null;
          unit_precision?: number;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          wattage?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'products_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_default_supplier_id_fkey';
            columns: ['default_supplier_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      receipt_lines: {
        Row: {
          created_at: string;
          delivery_id: string;
          evidence_id: string | null;
          id: string;
          order_line_id: string;
          quantity_damaged: number;
          quantity_good: number;
          stock_movement_ids: string[] | null;
        };
        Insert: {
          created_at?: string;
          delivery_id: string;
          evidence_id?: string | null;
          id?: string;
          order_line_id: string;
          quantity_damaged?: number;
          quantity_good?: number;
          stock_movement_ids?: string[] | null;
        };
        Update: {
          created_at?: string;
          delivery_id?: string;
          evidence_id?: string | null;
          id?: string;
          order_line_id?: string;
          quantity_damaged?: number;
          quantity_good?: number;
          stock_movement_ids?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'receipt_lines_delivery_id_fkey';
            columns: ['delivery_id'];
            isOneToOne: false;
            referencedRelation: 'deliveries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_lines_evidence_id_fkey';
            columns: ['evidence_id'];
            isOneToOne: false;
            referencedRelation: 'evidence';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_lines_order_line_id_fkey';
            columns: ['order_line_id'];
            isOneToOne: false;
            referencedRelation: 'order_lines';
            referencedColumns: ['id'];
          }
        ];
      };
      release_modes: {
        Row: {
          activation_time: string | null;
          approved_version: string | null;
          authorised_job_scope: string;
          ben_approval_reference: string | null;
          created_at: string;
          created_by: string | null;
          current_system: string;
          external_ids_protected_reference: string | null;
          fallback: string;
          function_id: string;
          function_name: string;
          id: string;
          mode: string;
          mode_record_basis: string;
          planned_target_mode: string;
          scope_boundary_notes: string | null;
          target_release: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          activation_time?: string | null;
          approved_version?: string | null;
          authorised_job_scope: string;
          ben_approval_reference?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_system: string;
          external_ids_protected_reference?: string | null;
          fallback: string;
          function_id: string;
          function_name: string;
          id?: string;
          mode: string;
          mode_record_basis: string;
          planned_target_mode: string;
          scope_boundary_notes?: string | null;
          target_release: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          activation_time?: string | null;
          approved_version?: string | null;
          authorised_job_scope?: string;
          ben_approval_reference?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_system?: string;
          external_ids_protected_reference?: string | null;
          fallback?: string;
          function_id?: string;
          function_name?: string;
          id?: string;
          mode?: string;
          mode_record_basis?: string;
          planned_target_mode?: string;
          scope_boundary_notes?: string | null;
          target_release?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'release_modes_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'release_modes_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      report_snapshots: {
        Row: {
          as_of_at: string;
          created_at: string;
          file_id: string | null;
          generated_by: string | null;
          id: string;
          period_end: string;
          period_start: string;
          policy_version: string;
          report_type: string;
          totals_json: Json;
          underlying_job_ids: string[];
        };
        Insert: {
          as_of_at: string;
          created_at?: string;
          file_id?: string | null;
          generated_by?: string | null;
          id?: string;
          period_end: string;
          period_start: string;
          policy_version: string;
          report_type: string;
          totals_json: Json;
          underlying_job_ids: string[];
        };
        Update: {
          as_of_at?: string;
          created_at?: string;
          file_id?: string | null;
          generated_by?: string | null;
          id?: string;
          period_end?: string;
          period_start?: string;
          policy_version?: string;
          report_type?: string;
          totals_json?: Json;
          underlying_job_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'report_snapshots_generated_by_fkey';
            columns: ['generated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      reservations: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          location_id: string;
          material_id: string;
          picked_at: string | null;
          picked_by: string | null;
          picked_quantity: number;
          product_id: string;
          quantity: number;
          status: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          location_id: string;
          material_id: string;
          picked_at?: string | null;
          picked_by?: string | null;
          picked_quantity?: number;
          product_id: string;
          quantity: number;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          location_id?: string;
          material_id?: string;
          picked_at?: string | null;
          picked_by?: string | null;
          picked_quantity?: number;
          product_id?: string;
          quantity?: number;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'reservations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reservations_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'stock_locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reservations_material_id_fkey';
            columns: ['material_id'];
            isOneToOne: false;
            referencedRelation: 'materials';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reservations_picked_by_fkey';
            columns: ['picked_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reservations_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reservations_updated_by_fkey';
            columns: ['updated_by'];
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
      scaffold_bookings: {
        Row: {
          access_notes: string | null;
          actual_cost_pence: number | null;
          company_id: string | null;
          confirmed_revision: number | null;
          created_at: string;
          created_by: string | null;
          erect_actual_at: string | null;
          erect_confirmed_at: string | null;
          erect_planned_at: string | null;
          id: string;
          invoice_reference: string | null;
          job_id: string;
          quoted_cost_pence: number | null;
          related_issue_ids: string[] | null;
          revision: number;
          scope_file_id: string | null;
          status: string;
          strip_actual_at: string | null;
          strip_authorised_at: string | null;
          strip_authorised_by: string | null;
          strip_confirmed_at: string | null;
          strip_forecast_at: string | null;
          strip_planned_at: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          access_notes?: string | null;
          actual_cost_pence?: number | null;
          company_id?: string | null;
          confirmed_revision?: number | null;
          created_at?: string;
          created_by?: string | null;
          erect_actual_at?: string | null;
          erect_confirmed_at?: string | null;
          erect_planned_at?: string | null;
          id?: string;
          invoice_reference?: string | null;
          job_id: string;
          quoted_cost_pence?: number | null;
          related_issue_ids?: string[] | null;
          revision?: number;
          scope_file_id?: string | null;
          status: string;
          strip_actual_at?: string | null;
          strip_authorised_at?: string | null;
          strip_authorised_by?: string | null;
          strip_confirmed_at?: string | null;
          strip_forecast_at?: string | null;
          strip_planned_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          access_notes?: string | null;
          actual_cost_pence?: number | null;
          company_id?: string | null;
          confirmed_revision?: number | null;
          created_at?: string;
          created_by?: string | null;
          erect_actual_at?: string | null;
          erect_confirmed_at?: string | null;
          erect_planned_at?: string | null;
          id?: string;
          invoice_reference?: string | null;
          job_id?: string;
          quoted_cost_pence?: number | null;
          related_issue_ids?: string[] | null;
          revision?: number;
          scope_file_id?: string | null;
          status?: string;
          strip_actual_at?: string | null;
          strip_authorised_at?: string | null;
          strip_authorised_by?: string | null;
          strip_confirmed_at?: string | null;
          strip_forecast_at?: string | null;
          strip_planned_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'scaffold_bookings_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scaffold_bookings_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scaffold_bookings_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scaffold_bookings_strip_authorised_by_fkey';
            columns: ['strip_authorised_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scaffold_bookings_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      settings: {
        Row: {
          changed_by: string | null;
          created_at: string;
          effective_from: string;
          id: string;
          key: string;
          reason: string | null;
          scope: string;
          typed_value: Json;
          version: number;
        };
        Insert: {
          changed_by?: string | null;
          created_at?: string;
          effective_from: string;
          id?: string;
          key: string;
          reason?: string | null;
          scope: string;
          typed_value: Json;
          version: number;
        };
        Update: {
          changed_by?: string | null;
          created_at?: string;
          effective_from?: string;
          id?: string;
          key?: string;
          reason?: string | null;
          scope?: string;
          typed_value?: Json;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'settings_changed_by_fkey';
            columns: ['changed_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
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
      stock_locations: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          job_id: string | null;
          name: string;
          type: string;
          updated_at: string;
          updated_by: string | null;
          usable: boolean;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          job_id?: string | null;
          name: string;
          type: string;
          updated_at?: string;
          updated_by?: string | null;
          usable: boolean;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          job_id?: string | null;
          name?: string;
          type?: string;
          updated_at?: string;
          updated_by?: string | null;
          usable?: boolean;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_locations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_locations_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_locations_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      stock_movements: {
        Row: {
          approval_id: string | null;
          created_at: string;
          evidence_id: string | null;
          from_location_id: string;
          id: string;
          idempotency_key: string;
          job_id: string | null;
          movement_at: string;
          movement_type: string;
          product_id: string;
          quantity: number;
          reason: string | null;
          receipt_line_id: string | null;
          to_location_id: string;
        };
        Insert: {
          approval_id?: string | null;
          created_at?: string;
          evidence_id?: string | null;
          from_location_id: string;
          id?: string;
          idempotency_key: string;
          job_id?: string | null;
          movement_at: string;
          movement_type: string;
          product_id: string;
          quantity: number;
          reason?: string | null;
          receipt_line_id?: string | null;
          to_location_id: string;
        };
        Update: {
          approval_id?: string | null;
          created_at?: string;
          evidence_id?: string | null;
          from_location_id?: string;
          id?: string;
          idempotency_key?: string;
          job_id?: string | null;
          movement_at?: string;
          movement_type?: string;
          product_id?: string;
          quantity?: number;
          reason?: string | null;
          receipt_line_id?: string | null;
          to_location_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_movements_evidence_id_fkey';
            columns: ['evidence_id'];
            isOneToOne: false;
            referencedRelation: 'evidence';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_movements_from_location_id_fkey';
            columns: ['from_location_id'];
            isOneToOne: false;
            referencedRelation: 'stock_locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_movements_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_movements_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_movements_receipt_line_id_fkey';
            columns: ['receipt_line_id'];
            isOneToOne: false;
            referencedRelation: 'receipt_lines';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_movements_to_location_id_fkey';
            columns: ['to_location_id'];
            isOneToOne: false;
            referencedRelation: 'stock_locations';
            referencedColumns: ['id'];
          }
        ];
      };
      stocktake_lines: {
        Row: {
          adjustment_movement_id: string | null;
          count_basis: string | null;
          counted_at: string | null;
          counted_by: string | null;
          counted_quantity: number | null;
          created_at: string;
          expected_quantity_at_cutoff: number;
          id: string;
          product_id: string;
          reason: string | null;
          stocktake_id: string;
          variance: number | null;
        };
        Insert: {
          adjustment_movement_id?: string | null;
          count_basis?: string | null;
          counted_at?: string | null;
          counted_by?: string | null;
          counted_quantity?: number | null;
          created_at?: string;
          expected_quantity_at_cutoff: number;
          id?: string;
          product_id: string;
          reason?: string | null;
          stocktake_id: string;
          variance?: number | null;
        };
        Update: {
          adjustment_movement_id?: string | null;
          count_basis?: string | null;
          counted_at?: string | null;
          counted_by?: string | null;
          counted_quantity?: number | null;
          created_at?: string;
          expected_quantity_at_cutoff?: number;
          id?: string;
          product_id?: string;
          reason?: string | null;
          stocktake_id?: string;
          variance?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'stocktake_lines_adjustment_movement_id_fkey';
            columns: ['adjustment_movement_id'];
            isOneToOne: false;
            referencedRelation: 'stock_movements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stocktake_lines_counted_by_fkey';
            columns: ['counted_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stocktake_lines_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stocktake_lines_stocktake_id_fkey';
            columns: ['stocktake_id'];
            isOneToOne: false;
            referencedRelation: 'stocktakes';
            referencedColumns: ['id'];
          }
        ];
      };
      stocktakes: {
        Row: {
          approved_by: string | null;
          counted_at: string;
          counted_by: string;
          created_at: string;
          cut_off_at: string;
          id: string;
          location_id: string;
          status: string;
        };
        Insert: {
          approved_by?: string | null;
          counted_at: string;
          counted_by: string;
          created_at?: string;
          cut_off_at: string;
          id?: string;
          location_id: string;
          status?: string;
        };
        Update: {
          approved_by?: string | null;
          counted_at?: string;
          counted_by?: string;
          created_at?: string;
          cut_off_at?: string;
          id?: string;
          location_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stocktakes_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stocktakes_counted_by_fkey';
            columns: ['counted_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stocktakes_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'stock_locations';
            referencedColumns: ['id'];
          }
        ];
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
      task_dependencies: {
        Row: {
          created_at: string;
          id: string;
          named_gate: string | null;
          prerequisite_task_id: string | null;
          satisfied_at: string | null;
          task_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          named_gate?: string | null;
          prerequisite_task_id?: string | null;
          satisfied_at?: string | null;
          task_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          named_gate?: string | null;
          prerequisite_task_id?: string | null;
          satisfied_at?: string | null;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_dependencies_prerequisite_task_id_fkey';
            columns: ['prerequisite_task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_dependencies_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          }
        ];
      };
      task_events: {
        Row: {
          action: string;
          actor: string | null;
          created_at: string;
          id: string;
          new_due: string | null;
          new_owner: string | null;
          new_status: string | null;
          occurred_at: string;
          old_due: string | null;
          old_owner: string | null;
          old_status: string | null;
          reason: string | null;
          task_id: string;
        };
        Insert: {
          action: string;
          actor?: string | null;
          created_at?: string;
          id?: string;
          new_due?: string | null;
          new_owner?: string | null;
          new_status?: string | null;
          occurred_at: string;
          old_due?: string | null;
          old_owner?: string | null;
          old_status?: string | null;
          reason?: string | null;
          task_id: string;
        };
        Update: {
          action?: string;
          actor?: string | null;
          created_at?: string;
          id?: string;
          new_due?: string | null;
          new_owner?: string | null;
          new_status?: string | null;
          occurred_at?: string;
          old_due?: string | null;
          old_owner?: string | null;
          old_status?: string | null;
          reason?: string | null;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_events_actor_fkey';
            columns: ['actor'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_events_new_owner_fkey';
            columns: ['new_owner'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_events_old_owner_fkey';
            columns: ['old_owner'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_events_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
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
          completion_mode: string;
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
          override_actor_id: string | null;
          override_at: string | null;
          override_bypassed: Json | null;
          override_reason: string | null;
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
          completion_mode?: string;
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
          override_actor_id?: string | null;
          override_at?: string | null;
          override_bypassed?: Json | null;
          override_reason?: string | null;
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
          completion_mode?: string;
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
          override_actor_id?: string | null;
          override_at?: string | null;
          override_bypassed?: Json | null;
          override_reason?: string | null;
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
            foreignKeyName: 'tasks_evidence_id_fkey';
            columns: ['evidence_id'];
            isOneToOne: false;
            referencedRelation: 'evidence';
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
            foreignKeyName: 'tasks_override_actor_id_fkey';
            columns: ['override_actor_id'];
            isOneToOne: false;
            referencedRelation: 'people';
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
      team_members: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          from_date: string | null;
          id: string;
          person_id: string;
          role: string;
          team_id: string;
          to_date: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          from_date?: string | null;
          id?: string;
          person_id: string;
          role: string;
          team_id: string;
          to_date?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          from_date?: string | null;
          id?: string;
          person_id?: string;
          role?: string;
          team_id?: string;
          to_date?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'team_members_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'team_members_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'team_members_team_id_fkey';
            columns: ['team_id'];
            isOneToOne: false;
            referencedRelation: 'teams';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'team_members_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      teams: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          notes: string | null;
          trade: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          trade: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          trade?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'teams_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'teams_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      technical_details: {
        Row: {
          annual_consumption_kwh: number | null;
          annual_generation_kwh: number | null;
          battery_kwh: number | null;
          created_at: string;
          created_by: string | null;
          electrical_notes: string | null;
          fuse_rating_amps: number | null;
          g99_reference: string | null;
          g99_status: string | null;
          id: string;
          job_id: string;
          mounting_orientation: string | null;
          mpan: string | null;
          ordering_notes: string | null;
          roof_design_file_id: string | null;
          roof_notes: string | null;
          roof_type: string | null;
          schematic_file_id: string | null;
          shutdown_file_id: string | null;
          survey_file_id: string | null;
          system_kw: number | null;
          technical_review_at: string | null;
          technical_review_by: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          annual_consumption_kwh?: number | null;
          annual_generation_kwh?: number | null;
          battery_kwh?: number | null;
          created_at?: string;
          created_by?: string | null;
          electrical_notes?: string | null;
          fuse_rating_amps?: number | null;
          g99_reference?: string | null;
          g99_status?: string | null;
          id?: string;
          job_id: string;
          mounting_orientation?: string | null;
          mpan?: string | null;
          ordering_notes?: string | null;
          roof_design_file_id?: string | null;
          roof_notes?: string | null;
          roof_type?: string | null;
          schematic_file_id?: string | null;
          shutdown_file_id?: string | null;
          survey_file_id?: string | null;
          system_kw?: number | null;
          technical_review_at?: string | null;
          technical_review_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          annual_consumption_kwh?: number | null;
          annual_generation_kwh?: number | null;
          battery_kwh?: number | null;
          created_at?: string;
          created_by?: string | null;
          electrical_notes?: string | null;
          fuse_rating_amps?: number | null;
          g99_reference?: string | null;
          g99_status?: string | null;
          id?: string;
          job_id?: string;
          mounting_orientation?: string | null;
          mpan?: string | null;
          ordering_notes?: string | null;
          roof_design_file_id?: string | null;
          roof_notes?: string | null;
          roof_type?: string | null;
          schematic_file_id?: string | null;
          shutdown_file_id?: string | null;
          survey_file_id?: string | null;
          system_kw?: number | null;
          technical_review_at?: string | null;
          technical_review_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'technical_details_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'technical_details_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: true;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'technical_details_technical_review_by_fkey';
            columns: ['technical_review_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'technical_details_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          }
        ];
      };
      work_packages: {
        Row: {
          actual_end: string | null;
          actual_start: string | null;
          commissioning_required: boolean;
          completion_outcome: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          installer_confirmation_at: string | null;
          installer_confirmation_by: string | null;
          job_id: string;
          need_by_date: string | null;
          parent_package_id: string | null;
          planned_end: string | null;
          planned_start: string | null;
          required: boolean;
          revision: number;
          sequence: number;
          status: string;
          trade: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          actual_end?: string | null;
          actual_start?: string | null;
          commissioning_required: boolean;
          completion_outcome?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          installer_confirmation_at?: string | null;
          installer_confirmation_by?: string | null;
          job_id: string;
          need_by_date?: string | null;
          parent_package_id?: string | null;
          planned_end?: string | null;
          planned_start?: string | null;
          required: boolean;
          revision?: number;
          sequence: number;
          status?: string;
          trade: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          actual_end?: string | null;
          actual_start?: string | null;
          commissioning_required?: boolean;
          completion_outcome?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          installer_confirmation_at?: string | null;
          installer_confirmation_by?: string | null;
          job_id?: string;
          need_by_date?: string | null;
          parent_package_id?: string | null;
          planned_end?: string | null;
          planned_start?: string | null;
          required?: boolean;
          revision?: number;
          sequence?: number;
          status?: string;
          trade?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'work_packages_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'work_packages_installer_confirmation_by_fkey';
            columns: ['installer_confirmation_by'];
            isOneToOne: false;
            referencedRelation: 'people';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'work_packages_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'work_packages_parent_package_id_fkey';
            columns: ['parent_package_id'];
            isOneToOne: false;
            referencedRelation: 'work_packages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'work_packages_updated_by_fkey';
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
      assistant_append_turn: {
        Args: {
          p_conversation_id: string;
          p_job_id?: string;
          p_messages: Json;
          p_model?: string;
          p_prompt_tokens?: number;
          p_provider?: string;
          p_run_id: string;
          p_title?: string;
        };
        Returns: {
          appended: boolean;
          conversation_id: string;
          estimated_tokens: number;
          message_count: number;
          title: string;
          version: number;
        }[];
      };
      assistant_claim_pending_action: {
        Args: { p_decision: string; p_id: string };
        Returns: Json;
      };
      assistant_complete_pending_action: {
        Args: { p_code?: string; p_id: string; p_succeeded: boolean };
        Returns: undefined;
      };
      assistant_register_pending_action: {
        Args: {
          p_args: Json;
          p_args_hash: string;
          p_expected_version: number;
          p_expires_at: string;
          p_id: string;
          p_preview: Json;
          p_thread_id: string;
          p_tool: string;
        };
        Returns: undefined;
      };
      assistant_release_pending_action: {
        Args: { p_id: string };
        Returns: undefined;
      };
      assistant_start_handoff: {
        Args: { p_source_id: string; p_summary?: string };
        Returns: string;
      };
      calendar_drift_candidates: { Args: { p_limit?: number }; Returns: Json };
      calendar_record_drift: {
        Args: { p_link_id: string; p_observed: Json };
        Returns: Json;
      };
      cancellation_preview: {
        Args: { p_effective_date?: string; p_job_id: string };
        Returns: Json;
      };
      current_actor: {
        Args: never;
        Returns: {
          display_name: string;
          email: string;
          person_id: string;
          roles: string[];
        }[];
      };
      describe_command_error: {
        Args: { p_command_id?: string; p_error: string; p_field?: string };
        Returns: Json;
      };
      describe_command_result: {
        Args: { p_command_type: string; p_result: Json };
        Returns: Json;
      };
      describe_command_result_pre_r1_completion: {
        Args: { p_command_type: string; p_result: Json };
        Returns: Json;
      };
      evidence_consistency: { Args: never; Returns: Json };
      evidence_open: { Args: { p_evidence_id: string }; Returns: Json };
      evidence_report_missing: {
        Args: { p_evidence_id: string };
        Returns: Json;
      };
      evidence_upload_begin: { Args: { p_request: Json }; Returns: Json };
      evidence_upload_complete: {
        Args: { p_evidence_id: string };
        Returns: Json;
      };
      execute_command: { Args: { p_request: Json }; Returns: Json };
      execute_operations_read: { Args: { p_request: Json }; Returns: Json };
      execute_read: { Args: { p_request: Json }; Returns: Json };
      file_browse: { Args: { p_request: Json }; Returns: Json };
      file_details: { Args: { p_request: Json }; Returns: Json };
      file_folder_create: { Args: { p_request: Json }; Returns: Json };
      file_folder_move: { Args: { p_request: Json }; Returns: Json };
      file_folder_rename: { Args: { p_request: Json }; Returns: Json };
      file_folder_restore: { Args: { p_request: Json }; Returns: Json };
      file_folder_trash: { Args: { p_request: Json }; Returns: Json };
      file_job_index: { Args: { p_request: Json }; Returns: Json };
      file_move: { Args: { p_request: Json }; Returns: Json };
      file_purge: { Args: { p_request: Json }; Returns: Json };
      file_rename: { Args: { p_request: Json }; Returns: Json };
      file_restore: { Args: { p_request: Json }; Returns: Json };
      file_search: { Args: { p_request: Json }; Returns: Json };
      file_trash: { Args: { p_request: Json }; Returns: Json };
      forms_enabled: { Args: never; Returns: boolean };
      forms_public_open: { Args: { p_token: string }; Returns: Json };
      forms_public_submit: {
        Args: { p_answers: Json; p_submission_id: string; p_token: string };
        Returns: Json;
      };
      health_ping: { Args: never; Returns: Json };
      help_health: { Args: never; Returns: Json };
      help_published_articles: {
        Args: { p_slug?: string };
        Returns: {
          aliases: string[];
          audience_roles: string[];
          body: string;
          category: string;
          common_task: boolean;
          keywords: string[];
          published_at: string;
          related_slugs: string[];
          release_functions: string[];
          release_names: string[];
          release_on: boolean;
          reviewed_at: string;
          revision_number: number;
          routes: string[];
          slug: string;
          sort_order: number;
          summary: string;
          title: string;
          tools: string[];
          updated_at: string;
        }[];
      };
      list_evidence: { Args: { p_request: Json }; Returns: Json };
      outbound_guard: {
        Args: {
          p_bcc?: string[];
          p_calendar_id?: string;
          p_cc?: string[];
          p_kind: string;
          p_to: string[];
        };
        Returns: Json;
      };
      outbox_claim: {
        Args: { p_action_types: string[]; p_limit?: number };
        Returns: Json;
      };
      outbox_record_failure: {
        Args: {
          p_backoff_minutes?: number[];
          p_error: string;
          p_max_attempts?: number;
          p_outbox_id: string;
          p_transient: boolean;
        };
        Returns: Json;
      };
      outbox_record_success: {
        Args: { p_external_id: string; p_outbox_id: string; p_summary: string };
        Returns: Json;
      };
      outbox_record_uncertain: {
        Args: { p_outbox_id: string; p_summary: string };
        Returns: Json;
      };
      outbox_release_stalled: {
        Args: { p_action_types?: string[]; p_minutes?: number };
        Returns: Json;
      };
      resilience_review_queue: { Args: never; Returns: Json };
      run_batch_chunk: {
        Args: { p_batch_id: string; p_limit?: number };
        Returns: Json;
      };
      search_evidence: { Args: { p_request: Json }; Returns: Json };
      submit_presale: {
        Args: { p_command_id: string; p_payload: Json };
        Returns: Json;
      };
      system_health: { Args: never; Returns: Json };
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

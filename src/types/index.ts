/**
 * Shared types for Augments MCP Server
 */

// Framework info for listing and search
export interface FrameworkInfo {
  name: string;
  display_name: string;
  category: string;
  type: string;
  description: string;
  tags: string[];
  priority: number;
  version: string;
}

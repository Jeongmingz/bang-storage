declare module "react-file-icon" {
  import { ComponentType } from "react";

  export type FileIconProps = {
    extension?: string;
  } & Record<string, unknown>;

  export const FileIcon: ComponentType<FileIconProps>;
  export const defaultStyles: Record<string, Record<string, string | number>>;
}

// onnxruntime-node 1.19 ships no types of its own; everything it exports comes from onnxruntime-common.
declare module "onnxruntime-node" {
  export * from "onnxruntime-common";
}

import * as THREE from 'three';

export class Trail {
  readonly line: THREE.Line;
  readonly data: Float32Array;
  private readonly attr: THREE.BufferAttribute;

  constructor(capacityVertices: number, color: string) {
    this.data = new Float32Array(3 * capacityVertices);
    this.attr = new THREE.BufferAttribute(this.data, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', this.attr);
    this.line = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({
        color,
        transparent: false,
        depthTest: true,
        depthWrite: true,
      }),
    );
    this.line.frustumCulled = false;
  }
  commit(count: number): void {
    this.line.geometry.setDrawRange(0, count);
    this.attr.needsUpdate = true;
  }
  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

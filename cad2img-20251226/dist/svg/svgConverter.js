import { DwgAttachmentPoint, DwgTextHorizontalAlign, isModelSpace } from '../database/index.js';
import { Box2D } from './box2d.js';
import { evaluateBSpline } from './bspline.js';
import { Color } from './color.js';
import { interpolatePolyline } from './polyline.js';

export class SvgConverter {
    blockMap = new Map();

    rotate(point, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: point.x * cos - point.y * sin,
            y: point.x * sin + point.y * cos
        };
    }

    interpolateBSpline(controlPoints, degree, knots, interpolationsPerSplineSegment = 25, weights) {
        const polyline = [];
        const controlPointsForLib = controlPoints.map((p) => [p.x, p.y]);
        const segmentTs = [knots[degree]];
        const domain = [
            knots[degree],
            knots[knots.length - 1 - degree]
        ];
        for (let k = degree + 1; k < knots.length - degree; ++k) {
            if (segmentTs[segmentTs.length - 1] !== knots[k]) {
                segmentTs.push(knots[k]);
            }
        }
        for (let i = 1; i < segmentTs.length; ++i) {
            const uMin = segmentTs[i - 1];
            const uMax = segmentTs[i];
            for (let k = 0; k <= interpolationsPerSplineSegment; ++k) {
                const u = (k / interpolationsPerSplineSegment) * (uMax - uMin) + uMin;
                let t = (u - domain[0]) / (domain[1] - domain[0]);
                t = Math.max(0, Math.min(1, t)); 
                const p = evaluateBSpline(t, degree, controlPointsForLib, knots, weights);
                polyline.push({ x: p[0], y: p[1] });
            }
        }
        return polyline;
    }

    addFlipXIfApplicable(entity, { bbox, element }) {
        if ('extrusionDirection' in entity &&
            entity.extrusionDirection.z === -1) {
            return {
                bbox: new Box2D()
                    .expandByPoint({ x: -bbox.min.x, y: bbox.min.y })
                    .expandByPoint({ x: -bbox.max.x, y: bbox.max.y }),
                element: `<g transform="matrix(-1 0 0 1 0 0)">${element}</g>`
            };
        }
        else {
            return { bbox, element };
        }
    }

    line(entity) {
        const bbox = new Box2D()
            .expandByPoint({ x: entity.startPoint.x, y: entity.startPoint.y })
            .expandByPoint({ x: entity.endPoint.x, y: entity.endPoint.y });
        const element = `<line x1="${entity.startPoint.x}" y1="${entity.startPoint.y}" x2="${entity.endPoint.x}" y2="${entity.endPoint.y}" />`;
        return { bbox, element };
    }

    ray(entity) {
        const scale = 10000;
        const firstPoint = entity.firstPoint;
        const secondPoint = {
            x: firstPoint.x + entity.unitDirection.x * scale,
            y: firstPoint.y + entity.unitDirection.y * scale
        };
        const bbox = new Box2D()
            .expandByPoint(firstPoint)
            .expandByPoint(secondPoint);
        const element = `<line x1="${firstPoint.x}" y1="${firstPoint.y}" x2="${secondPoint.x}" y2="${secondPoint.y}" />`;
        return { bbox, element };
    }

    xline(entity) {
        const scale = 10000;
        const firstPoint = {
            x: entity.firstPoint.x - entity.unitDirection.x * scale,
            y: entity.firstPoint.y - entity.unitDirection.y * scale
        };
        const secondPoint = {
            x: entity.firstPoint.x + entity.unitDirection.x * scale,
            y: entity.firstPoint.y + entity.unitDirection.y * scale
        };
        const bbox = new Box2D()
            .expandByPoint(firstPoint)
            .expandByPoint(secondPoint);
        const element = `<line x1="${firstPoint.x}" y1="${firstPoint.y}" x2="${secondPoint.x}" y2="${secondPoint.y}" />`;
        return { bbox, element };
    }

    extractMTextLines(mtext) {
        return (mtext
            .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\P/g, '\n')
            .replace(/\\[LOlo]/g, '')
            .replace(/\\[Ff][^;\\]*?(?:\|[^;\\]*)*;/g, '')
            .replace(/\\[KkCcHhWwTtAa][^;\\]*;?/g, '')
            .replace(/\\[a-zA-Z]+;?/g, '')
            .replace(/%%(d|p|c|%)/gi, '')
            .replace(/\\\\/g, '\\')
            .replace(/\\~/g, '\u00A0')
            .replace(/[{}]/g, '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0));
    }

    lines(lines, fontsize, insertionPoint, extentsWidth, anchor = 'start') {
        const bbox = new Box2D()
            .expandByPoint({
            x: insertionPoint.x,
            y: insertionPoint.y
        })
            .expandByPoint({
            x: insertionPoint.x + extentsWidth,
            y: insertionPoint.y - lines.length * fontsize * 1.5
        });
        const texts = lines.map((line, index) => {
            const x = insertionPoint.x;
            const y = insertionPoint.y - index * fontsize * 1.5;
            const transform = `translate(${x},${y}) scale(1,-1) translate(${-x},${-y})`;
            // Fix: sanitizeSvgText added here
            return `<text x="${x}" y="${y}" font-size="${fontsize}" text-anchor="${anchor}" transform="${transform}">${sanitizeSvgText(line)}</text>`;
        });
        return { bbox, element: texts.join('\n') };
    }

    mtext(entity) {
        const fontsize = entity.textHeight;
        const insertionPoint = entity.insertionPoint;
        const lines = this.extractMTextLines(entity.text);
        const attachmentPoint = entity.attachmentPoint;
        let anchor = 'start';
        if (attachmentPoint == DwgAttachmentPoint.BottomCenter ||
            attachmentPoint == DwgAttachmentPoint.MiddleCenter ||
            attachmentPoint == DwgAttachmentPoint.TopCenter) {
            anchor = 'middle';
        }
        else if (attachmentPoint == DwgAttachmentPoint.BottomRight ||
            attachmentPoint == DwgAttachmentPoint.MiddleRight ||
            attachmentPoint == DwgAttachmentPoint.TopRight) {
            anchor = 'end';
        }
        return this.lines(lines, fontsize, insertionPoint, entity.extentsWidth, anchor);
    }

    table(entity) {
        const { rowCount, columnCount, rowHeightArr, columnWidthArr, startPoint, cells } = entity;
        const originX = startPoint.x;
        const originY = startPoint.y;
        
        const cellRects = [];
        for (let row = 0, y = originY; row < rowCount; row++) {
            const height = rowHeightArr[row];
            let x = originX;
            for (let col = 0; col < columnCount; col++) {
                const cellIndex = row * columnCount + col;
                const cell = cells[cellIndex];
                const width = columnWidthArr[col];
                cellRects.push({ x, y, width, height, cell, row, col });
                x += width;
            }
            y += height;
        }
        
        const svgElements = cellRects
            .map(({ x, y, width, height, cell }) => {
                const lines = [];
                // 强制边框为黑色，防止不可见
                const borderStyle = 'stroke="black" stroke-width="1"';
                
                if (cell.topBorderVisibility)
                    lines.push(`<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" ${borderStyle} />`);
                if (cell.bottomBorderVisibility)
                    lines.push(`<line x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}" ${borderStyle} />`);
                if (cell.leftBorderVisibility)
                    lines.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}" ${borderStyle} />`);
                if (cell.rightBorderVisibility)
                    lines.push(`<line x1="${x + width}" y1="${y}" x2="${x + width}" y2="${y + height}" ${borderStyle} />`);
                
                const textX = x + width / 2;
                const textY = y + height / 2 + cell.textHeight / 3;
                
                const transform = `translate(${textX},${textY}) scale(1,-1) translate(${-textX},${-textY})`;
                const text = `<text x="${textX}" y="${textY}" font-size="${cell.textHeight}" text-anchor="middle" dominant-baseline="middle" fill="black" stroke="none" transform="${transform}">${sanitizeSvgText(cell.text)}</text>`;
                
                return [...lines, text].join('\n');
            })
            .join('\n');
            
        const totalWidth = columnWidthArr.reduce((sum, w) => sum + w, 0);
        const totalHeight = rowHeightArr.reduce((sum, h) => sum + h, 0);
        const bbox = new Box2D()
            .expandByPoint({ x: originX, y: originY })
            .expandByPoint({ x: originX + totalWidth, y: originY + totalHeight });
            
        const svg = `<g>${svgElements}</g>`;
        return {
            bbox,
            element: svg
        };
    }

    text(entity) {
        const fontsize = entity.textHeight || 12;
        const insertionPoint = entity.startPoint;
        const lines = [entity.text ?? ''];

        let extentsWidth = 0;

        // 优先用 endPoint-startPoint（如果存在且有效）
        if (entity.endPoint && entity.startPoint) {
            const w = entity.endPoint.x - entity.startPoint.x;
            if (Number.isFinite(w) && w > 0) extentsWidth = w;
        }

        // 兜底：用字符数估算宽度（不要加 startPoint.x！）
        if (!Number.isFinite(extentsWidth) || extentsWidth <= 0) {
            const text = String(entity.text ?? '');
            extentsWidth = text.length * fontsize; // 粗略估算
        }

        let anchor = 'start';
        if (entity.halign == DwgTextHorizontalAlign.CENTER) anchor = 'middle';
        else if (entity.halign == DwgTextHorizontalAlign.RIGHT) anchor = 'end';

        return this.lines(lines, fontsize, insertionPoint, extentsWidth, anchor);
    }

    vertices(vertices, closed = false) {
        const bbox = vertices.reduce((acc, point) => acc.expandByPoint(point), new Box2D());
        let d = vertices.reduce((acc, point, i) => {
            acc += i === 0 ? 'M' : 'L';
            acc += point.x + ',' + point.y;
            return acc;
        }, '');
        if (closed) {
            d += 'Z';
        }
        return { bbox, element: `<path d="${d}" />` };
    }

    circle(entity) {
        const bbox0 = new Box2D()
            .expandByPoint({
            x: entity.center.x + entity.radius,
            y: entity.center.y + entity.radius
        })
            .expandByPoint({
            x: entity.center.x - entity.radius,
            y: entity.center.y - entity.radius
        });
        const element0 = `<circle cx="${entity.center.x}" cy="${entity.center.y}" r="${entity.radius}" />`;
        return {
            bbox: bbox0,
            element: element0
        };
    }

    ellipseOrArc(cx, cy, majorX, majorY, axisRatio, startAngle, endAngle) {
        const rx = Math.sqrt(majorX * majorX + majorY * majorY);
        const ry = axisRatio * rx;
        const rotationAngle = -Math.atan2(-majorY, majorX);
        const bbox = this.bboxEllipseOrArc(cx, cy, majorX, majorY, axisRatio, startAngle, endAngle);
        if (Math.abs(startAngle - endAngle) < 1e-9 ||
            Math.abs(startAngle - endAngle + Math.PI * 2) < 1e-9) {
            const element = `<g transform="rotate(${(rotationAngle / Math.PI) * 180} ${cx}, ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" /></g>`;
            return { bbox, element };
        }
        else {
            const startOffset = this.rotate({ x: Math.cos(startAngle) * rx, y: Math.sin(startAngle) * ry }, rotationAngle);
            const startPoint = { x: cx + startOffset.x, y: cy + startOffset.y };
            const endOffset = this.rotate({ x: Math.cos(endAngle) * rx, y: Math.sin(endAngle) * ry }, rotationAngle);
            const endPoint = { x: cx + endOffset.x, y: cy + endOffset.y };
            const adjustedEndAngle = endAngle < startAngle ? endAngle + Math.PI * 2 : endAngle;
            const largeArcFlag = adjustedEndAngle - startAngle < Math.PI ? 0 : 1;
            const d = `M ${startPoint.x} ${startPoint.y} A ${rx} ${ry} ${(rotationAngle / Math.PI) * 180} ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y}`;
            const element = `<path d="${d}" />`;
            return { bbox, element };
        }
    }

    bboxEllipseOrArc(cx, cy, majorX, majorY, axisRatio, startAngle, endAngle) {
        while (startAngle < 0)
            startAngle += Math.PI * 2;
        while (endAngle <= startAngle)
            endAngle += Math.PI * 2;
        const angles = [];
        if (Math.abs(majorX) < 1e-12 || Math.abs(majorY) < 1e-12) {
            for (let i = 0; i < 4; i++) {
                angles.push((i / 2) * Math.PI);
            }
        }
        else {
            angles[0] = Math.atan((-majorY * axisRatio) / majorX) - Math.PI;
            angles[1] = Math.atan((majorX * axisRatio) / majorY) - Math.PI;
            angles[2] = angles[0] - Math.PI;
            angles[3] = angles[1] - Math.PI;
        }
        for (let i = 4; i >= 0; i--) {
            while (angles[i] < startAngle)
                angles[i] += Math.PI * 2;
            if (angles[i] > endAngle) {
                angles.splice(i, 1);
            }
        }
        angles.push(startAngle);
        angles.push(endAngle);
        const pts = angles.map(a => ({ x: Math.cos(a), y: Math.sin(a) }));
        const M = [
            [majorX, -majorY * axisRatio],
            [majorY, majorX * axisRatio]
        ];
        const rotatedPts = pts.map(p => ({
            x: p.x * M[0][0] + p.y * M[0][1] + cx,
            y: p.x * M[1][0] + p.y * M[1][1] + cy
        }));
        const bbox = rotatedPts.reduce((acc, p) => {
            acc.expandByPoint(p);
            return acc;
        }, new Box2D());
        return bbox;
    }

    ellipse(entity) {
        const { bbox: bbox0, element: element0 } = this.ellipseOrArc(entity.center.x, entity.center.y, entity.majorAxisEndPoint.x, entity.majorAxisEndPoint.y, entity.axisRatio, entity.startAngle, entity.endAngle);
        return {
            bbox: bbox0,
            element: element0
        };
    }

    arc(entity) {
        const { bbox: bbox0, element: element0 } = this.ellipseOrArc(entity.center.x, entity.center.y, entity.radius, 0, 1, entity.startAngle, entity.endAngle);
        return {
            bbox: bbox0,
            element: element0
        };
    }

    dimension(entity) {
        const block = this.blockMap.get(entity.name);
        if (block) {
            return {
                bbox: block.bbox,
                element: `<use href="#${entity.name}" />`
            };
        }
        return null;
    }

    insert(entity) {
        const block = this.blockMap.get(entity.name);
        if (block) {
            const insertionPoint = entity.insertionPoint;
            const rotation = entity.rotation * (180 / Math.PI);
            const transform = `translate(${insertionPoint.x},${insertionPoint.y}) rotate(${rotation}) scale(${entity.xScale},${entity.yScale})`;
            const newBBox = block.bbox
                .clone()
                .transform({ x: entity.xScale, y: entity.yScale }, { x: insertionPoint.x, y: insertionPoint.y })
                .rotate(entity.rotation, insertionPoint);
            return {
                bbox: newBBox,
                element: `<use href="#${entity.name}" transform="${transform}" />`
            };
        }
        return null;
    }

    // 修复文字因继承 fill="none" 而消失的 Bug
    block(block, dwg, groupByLayer = false) {
        if (!block || !block.entities || !Array.isArray(block.entities)) {
            return null;
        }
        const entities = block.entities;
        
        const acc = entities.reduce((acc, entity) => {
            const boundsAndElement = this.entityToBoundsAndElement(entity);
            if (boundsAndElement) {
                const { bbox, element } = boundsAndElement;
                if (bbox.valid) {
                    acc.bbox.expandByPoint(bbox.min);
                    acc.bbox.expandByPoint(bbox.max);
                }
                const color = this.getEntityColor(dwg.tables.LAYER.entries, entity);
                
                // 1. 计算填充色
                // 如果是文字，必须有填充色；如果是线条，填充为 none
                let fill = 'none';
                if (entity.type == 'TEXT' || entity.type == 'MTEXT') {
                    // 如果颜色解析出是 CSS 颜色，就用它
                    if (color.cssColor) {
                        fill = color.cssColor;
                    }
                    // 如果没解析出颜色(比如白色被转义)，或者 cssColor 无效，强制黑色
                    if (!fill || fill === 'none' || fill === '#ffffff') {
                         fill = '#000000';
                    }
                }

                // 2. 生成图元组
                let entityGroup;
                
                if (color.isByBlock) {
                    // 关键修复：ByBlock 的文字不能继承 root 的 fill="none"，必须显式给黑色
                    if (entity.type == 'TEXT' || entity.type == 'MTEXT') {
                        entityGroup = `<g id="${entity.handle}" fill="#000000" stroke="none">${element}</g>`;
                    } else {
                        // 普通线条 ByBlock 继承父级 stroke，fill 保持 none
                        entityGroup = `<g id="${entity.handle}">${element}</g>`;
                    }
                } else {
                    // 普通颜色：显式设置 stroke 和 fill
                    entityGroup = `<g id="${entity.handle}" stroke="${color.cssColor}" fill="${fill}">${element}</g>`;
                }

                if (!groupByLayer) {
                    acc.elements.push(entityGroup);
                } else {
                    const layerName = (entity.layer != null && String(entity.layer).length > 0)
                        ? String(entity.layer)
                        : '__NO_LAYER__';

                    if (!acc.layerToElements.has(layerName)) {
                        acc.layerToElements.set(layerName, []);
                        acc.layerOrder.push(layerName);
                    }
                    acc.layerToElements.get(layerName).push(entityGroup);
                }
            }
            return acc;
        }, {
            bbox: new Box2D(),
            elements: [],
            layerToElements: new Map(),
            layerOrder: []
        });

        if (!acc.bbox.valid) return null;

        if (!groupByLayer) {
            return {
                bbox: acc.bbox,
                element: `<g id="${block.name}">${acc.elements.join('\n')}</g>`
            };
        }

        const layerGroups = acc.layerOrder.map((layerName) => {
            const safeAttr = escapeXmlAttr(layerName);
            const safeId = 'layer-' + layerName.replace(/[^a-zA-Z0-9\-_:.]/g, '_');
            const content = acc.layerToElements.get(layerName).join('\n');
            return `<g id="${safeId}" data-layer-name="${safeAttr}">\n${content}\n</g>`;
        });

        return {
            bbox: acc.bbox,
            element: `<g id="${block.name}">\n${layerGroups.join('\n')}\n</g>`
        };
    }

    entityToBoundsAndElement(entity) {
        let result = null;
        switch (entity.type) {
            case 'ARC': result = this.arc(entity); break;
            case 'CIRCLE': result = this.circle(entity); break;
            case 'DIMENSION': result = this.dimension(entity); break;
            case 'ELLIPSE': result = this.ellipse(entity); break;
            case 'INSERT': result = this.insert(entity); break;
            case 'LINE': result = this.line(entity); break;
            case 'LWPOLYLINE': {
                const lwpolyline = entity;
                const closed = !!(lwpolyline.flag & 0x200);
                const vertices = interpolatePolyline(lwpolyline, closed);
                result = this.vertices(vertices, closed);
                break;
            }
            case 'MTEXT': result = this.mtext(entity); break;
            case 'SPLINE': {
                const spline = entity;
                result = this.vertices(this.interpolateBSpline(spline.controlPoints, spline.degree, spline.knots, 25, spline.weights));
                break;
            }
            case 'POLYLINE': break;
            case 'RAY': result = this.ray(entity); break;
            case 'TABLE': result = this.table(entity); break;
            case 'TEXT': result = this.text(entity); break;
            case 'XLINE': result = this.xline(entity); break;
            default: result = null; break;
        }
        if (result) {
            return this.addFlipXIfApplicable(entity, result);
        }
        return null;
    }

    getEntityColor(layers, entity) {
        const color = new Color();

        // 1. 优先读取真彩色 (TrueColor) - 这是修复颜色不对的关键！
        if (entity.trueColor != null) {
            color.color = entity.trueColor;
        } 
        else if (entity.colorIndex != null) {
            color.colorIndex = entity.colorIndex;
        } 
        else if (entity.colorName) {
            color.colorName = entity.colorName;
        } 
        else if (entity.color != null) {
            color.color = entity.color;
        }

        // 2. 处理 ByLayer (随层)
        if (color.isByLayer && layers) {
            const layer = layers.find((layer) => layer.name === entity.layer);
            if (layer != null) {
                // 层也可能有真彩色
                if (layer.trueColor != null) {
                    color.color = layer.trueColor;
                    color.colorIndex = null;
                } else if (layer.color != null) {
                    color.color = layer.color;
                    color.colorIndex = null;
                } else if (layer.colorIndex != null) {
                    color.colorIndex = layer.colorIndex;
                }
            }
        }

        // 3. 兜底逻辑：如果什么色都没读到，默认黑色 (防止白色消失)
        // 注意：CAD里 7 号色是黑/白自动反转，SVG里我们强制黑
        if (color.colorIndex === 7) {
            color.color = 0x000000;
            color.colorIndex = null;
        }
        
        // 如果完全没有颜色信息，默认为黑色 (以前是白色导致消失)
        if (color.color == null && color.colorIndex == null && !color.colorName) {
            color.color = 0x000000;
        }

        return color;
    }

    convert(dwg) {
        let modelSpace = null;
        this.blockMap.clear();
        let blockElements = '';
        dwg.tables.BLOCK_RECORD.entries.forEach(block => {
            if (isModelSpace(block.name)) {
                modelSpace = block;
            }
            else {
                // block definitions are not grouped by layer
                const item = this.block(block, dwg, false);
                if (item) {
                    blockElements += item.element;
                    this.blockMap.set(block.name, item);
                }
            }
        });
        
        // Fix: ModelSpace MUST be grouped by layer for PDF export
        const ms = modelSpace ? this.block(modelSpace, dwg, true) : null;
        
        const viewBox = ms && ms.bbox && ms.bbox.valid
            ? {
                x: ms.bbox.min.x,
                y: -ms.bbox.max.y,
                width: ms.bbox.max.x - ms.bbox.min.x,
                height: ms.bbox.max.y - ms.bbox.min.y
            }
            : {
                x: 0,
                y: 0,
                width: 0,
                height: 0
            };
            
        return `<?xml version="1.0"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"
  preserveAspectRatio="xMinYMin meet"
  viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"
  width="100%" height="100%"
>
  <defs>${blockElements}</defs>
  <g stroke-width="0.1%" fill="none" transform="matrix(1,0,0,-1,0,0)">
    ${ms ? ms.element : ''}
  </g>
</svg>`;
    }
}

function escapeXmlAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeXmlText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function sanitizeSvgText(input) {
    const str = String(input ?? '');
    let out = '';

    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = str.charCodeAt(i + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) {
                out += str[i] + str[i + 1];
                i++;
            } else {
                out += '\uFFFD';
            }
            continue;
        }
        if (code >= 0xDC00 && code <= 0xDFFF) {
            out += '\uFFFD';
            continue;
        }
        if (code === 0x9 || code === 0xA || code === 0xD ||
            (code >= 0x20 && code <= 0xD7FF) ||
            (code >= 0xE000 && code <= 0xFFFD)) {
            out += str[i];
        } else {
            out += '\uFFFD';
        }
    }
    return escapeXmlText(out);
}
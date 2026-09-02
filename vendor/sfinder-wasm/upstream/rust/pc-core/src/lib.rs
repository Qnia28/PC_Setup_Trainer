pub mod min_cover;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hash, Hasher};
use std::mem::size_of;
use std::rc::Rc;

pub const WIDTH: u8 = 10;
pub const MAX_HEIGHT: u8 = 6;
pub const FULL_ROW: u64 = 0x3ff;
const ANCHOR_STRIDE: i32 = 16;

#[derive(Default)]
pub struct FastHasher(u64);
impl Hasher for FastHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        let mut h = self.0 ^ 0x517cc1b727220a95;
        for &b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(0x9e3779b185ebca87);
            h ^= h >> 29;
        }
        self.0 = h;
    }
    #[inline]
    fn write_u64(&mut self, i: u64) {
        let mut x = i.wrapping_add(0x9e3779b97f4a7c15);
        x = (x ^ (x >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        x = (x ^ (x >> 27)).wrapping_mul(0x94d049bb133111eb);
        x ^= x >> 31;
        self.0 ^= x.wrapping_add(0x517cc1b727220a95);
        self.0 = self.0.rotate_left(27).wrapping_mul(0x94d049bb133111eb);
    }
    #[inline]
    fn write_usize(&mut self, i: usize) {
        self.write_u64(i as u64)
    }
    #[inline]
    fn write_u8(&mut self, i: u8) {
        self.write_u64(i as u64)
    }
}
pub type FastBuildHasher = BuildHasherDefault<FastHasher>;
pub type FastMap<K, V> = HashMap<K, V, FastBuildHasher>;
pub type FastSet<K> = HashSet<K, FastBuildHasher>;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
#[repr(u8)]
pub enum Piece {
    I = 0,
    J = 1,
    L = 2,
    O = 3,
    S = 4,
    T = 5,
    Z = 6,
}
impl Piece {
    pub const ALL: [Piece; 7] = [
        Self::I,
        Self::J,
        Self::L,
        Self::O,
        Self::S,
        Self::T,
        Self::Z,
    ];
    pub fn from_u8(v: u8) -> Option<Self> {
        Some(match v {
            0 => Self::I,
            1 => Self::J,
            2 => Self::L,
            3 => Self::O,
            4 => Self::S,
            5 => Self::T,
            6 => Self::Z,
            _ => return None,
        })
    }
    pub fn from_char(c: u8) -> Option<Self> {
        Some(match c {
            b'I' => Self::I,
            b'J' => Self::J,
            b'L' => Self::L,
            b'O' => Self::O,
            b'S' => Self::S,
            b'T' => Self::T,
            b'Z' => Self::Z,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Physics {
    Jstris,
    Tetrio,
}

pub const CELLS: [[[(i8, i8); 4]; 4]; 7] = [
    [
        [(0, 0), (1, 0), (2, 0), (3, 0)],
        [(0, 0), (0, 1), (0, 2), (0, 3)],
        [(0, 0), (1, 0), (2, 0), (3, 0)],
        [(0, 0), (0, 1), (0, 2), (0, 3)],
    ],
    [
        [(0, 0), (1, 0), (2, 0), (0, 1)],
        [(0, 0), (0, 1), (0, 2), (1, 2)],
        [(2, 0), (0, 1), (1, 1), (2, 1)],
        [(0, 0), (1, 0), (1, 1), (1, 2)],
    ],
    [
        [(0, 0), (1, 0), (2, 0), (2, 1)],
        [(0, 0), (1, 0), (0, 1), (0, 2)],
        [(0, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (1, 1), (0, 2), (1, 2)],
    ],
    [
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
    ],
    [
        [(0, 0), (1, 0), (1, 1), (2, 1)],
        [(1, 0), (0, 1), (1, 1), (0, 2)],
        [(0, 0), (1, 0), (1, 1), (2, 1)],
        [(1, 0), (0, 1), (1, 1), (0, 2)],
    ],
    [
        [(0, 0), (1, 0), (2, 0), (1, 1)],
        [(0, 0), (0, 1), (1, 1), (0, 2)],
        [(1, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (0, 1), (1, 1), (1, 2)],
    ],
    [
        [(1, 0), (2, 0), (0, 1), (1, 1)],
        [(0, 0), (0, 1), (1, 1), (1, 2)],
        [(1, 0), (2, 0), (0, 1), (1, 1)],
        [(0, 0), (0, 1), (1, 1), (1, 2)],
    ],
];
const MAX_X: [[i8; 4]; 7] = [
    [6, 9, 6, 9],
    [7, 8, 7, 8],
    [7, 8, 7, 8],
    [8, 8, 8, 8],
    [7, 8, 7, 8],
    [7, 8, 7, 8],
    [7, 8, 7, 8],
];
const MAX_Y: [[i8; 4]; 7] = [
    [0, 3, 0, 3],
    [1, 2, 1, 2],
    [1, 2, 1, 2],
    [1, 1, 1, 1],
    [1, 2, 1, 2],
    [1, 2, 1, 2],
    [1, 2, 1, 2],
];
const JLSTZ_CW: [[(i8, i8); 5]; 4] = [
    [(1, -1), (0, -1), (0, 0), (1, -3), (0, -3)],
    [(-1, 0), (0, 0), (0, -1), (-1, 2), (0, 2)],
    [(0, 0), (1, 0), (1, 1), (0, -2), (1, -2)],
    [(0, 1), (-1, 1), (-1, 0), (0, 3), (-1, 3)],
];
const JLSTZ_CCW: [[(i8, i8); 5]; 4] = [
    [(0, -1), (1, -1), (1, 0), (0, -3), (1, -3)],
    [(-1, 1), (0, 1), (0, 0), (-1, 3), (0, 3)],
    [(1, 0), (0, 0), (0, 1), (1, -2), (0, -2)],
    [(0, 0), (-1, 0), (-1, -1), (0, 2), (-1, 2)],
];
const I_CW: [[(i8, i8); 5]; 4] = [
    [(2, -2), (0, -2), (3, -2), (0, -3), (3, 0)],
    [(-2, 1), (-3, 1), (0, 1), (-3, 3), (0, 0)],
    [(1, -1), (3, -1), (0, -1), (3, 0), (0, -3)],
    [(-1, 2), (0, 2), (-3, 2), (0, 0), (-3, 3)],
];
const I_CCW: [[(i8, i8); 5]; 4] = [
    [(1, -2), (0, -2), (3, -2), (0, 0), (3, -3)],
    [(-2, 2), (0, 2), (-3, 2), (0, 3), (-3, 0)],
    [(2, -1), (3, -1), (0, -1), (3, -3), (0, 0)],
    [(-1, 1), (-3, 1), (0, 1), (-3, 0), (0, 3)],
];
const HALF: [[(i8, i8); 2]; 4] = [
    [(0, -1), (0, 0)],
    [(-1, 0), (0, 0)],
    [(0, 1), (0, 0)],
    [(1, 0), (0, 0)],
];
const TETRIO_HALF: [[(i8, i8); 6]; 4] = [
    [(0, -1), (0, 0), (1, 0), (-1, 0), (1, -1), (-1, -1)],
    [(-1, 0), (0, 0), (0, 2), (0, 1), (-1, 2), (-1, 1)],
    [(0, 1), (0, 0), (-1, 0), (1, 0), (-1, 1), (1, 1)],
    [(1, 0), (0, 0), (0, 2), (0, 1), (1, 2), (1, 1)],
];
const TETRIO_I_CW: [[(i8, i8); 5]; 4] = [
    [(2, -2), (3, -2), (0, -2), (0, -3), (3, 0)],
    I_CW[1],
    I_CW[2],
    I_CW[3],
];
const TETRIO_I_CCW: [[(i8, i8); 5]; 4] = [
    [(1, -2), (0, -2), (3, -2), (3, -3), (0, 0)],
    [(-2, 2), (-3, 2), (0, 2), (-3, 0), (0, 3)],
    [(2, -1), (0, -1), (3, -1), (0, 0), (3, -3)],
    [(-1, 1), (0, 1), (-3, 1), (0, 3), (-3, 0)],
];

#[inline]
pub fn board_mask(height: u8) -> u64 {
    (1u64 << (height as u32 * 10)) - 1
}
#[inline]
pub fn full_board(height: u8) -> u64 {
    board_mask(height)
}
#[inline]
pub fn row(board: u64, y: u8) -> u64 {
    (board >> (y as u32 * 10)) & FULL_ROW
}
#[inline]
pub fn cleared_floor(board: u64, height: u8) -> u8 {
    let mut c = 0;
    while c < height && row(board, c) == FULL_ROW {
        c += 1
    }
    c
}

pub fn normalize_after_placement(board: u64, height: u8) -> u64 {
    let mut incomplete = [0u64; MAX_HEIGHT as usize];
    let mut n = 0usize;
    let mut complete = 0u8;
    for y in 0..height {
        let r = row(board, y);
        if r == FULL_ROW {
            complete += 1
        } else {
            incomplete[n] = r;
            n += 1
        }
    }
    let mut out = 0u64;
    for y in 0..complete {
        out |= FULL_ROW << (y as u32 * 10)
    }
    for (i, r) in incomplete[..n].iter().enumerate() {
        out |= *r << ((i as u32 + complete as u32) * 10)
    }
    out
}
#[inline]
fn get_cell(board: u64, x: i8, y: i8) -> bool {
    if !(0..10).contains(&x) || !(0..4).contains(&y) {
        return false;
    }
    board & (1u64 << (y as u32 * 10 + x as u32)) != 0
}
pub fn has_isolated_cell(board: u64) -> bool {
    for x in 0..10i8 {
        let (mut non_empty, mut full, mut every) = (false, true, true);
        for y in 0..4i8 {
            let here = get_cell(board, x, y);
            non_empty |= here;
            full &= here;
            if !here {
                let l = x == 0 || get_cell(board, x - 1, y);
                let r = x == 9 || get_cell(board, x + 1, y);
                if !(l && r) {
                    every = false
                }
            }
        }
        if non_empty && !full && every {
            return true;
        }
    }
    false
}
pub fn has_imbalanced_split(board: u64) -> bool {
    for split in 1..=7i8 {
        let mut blocked = true;
        for y in 0..4i8 {
            if !(get_cell(board, split, y) || get_cell(board, split + 1, y)) {
                blocked = false;
                break;
            }
        }
        if !blocked {
            continue;
        }
        let mut filled = 0;
        for x in 0..=split {
            for y in 0..4i8 {
                if get_cell(board, x, y) {
                    filled += 1
                }
            }
        }
        if filled % 4 != 0 {
            return true;
        }
    }
    false
}

// Partition columns 0..9 into maximal horizontal runs: columns x and x+1 share
// a run iff some row has both cells empty (a 4-connected tetromino spanning that
// gap needs a horizontal domino there).
//
// A disconnected gap can never reconnect: emptiness is monotone (placements only
// fill cells) and row normalization is a whole-row permutation, so a gap with no
// row where both adjacent cells are empty remains disconnected in every
// descendant state.
//
// Because no tetromino can cross a disconnected gap, each run's empty cells must
// be independently covered by some subset of the remaining pieces. Each
// tetromino covers exactly 4 cells, so every run's empty count must be
// divisible by 4.
#[inline]
fn column_run_reject(board: u64, height: u8) -> bool {
    // col_empty[x]: one bit per row, set when cell (x, y) is empty.
    let mut col_empty = [0u16; 10];
    for y in 0..height as u32 {
        let row_filled = (board >> (y * 10)) as u16 & 0x3ff;
        let row_empty = !row_filled & 0x3ff;
        let mut mask = row_empty;
        while mask != 0 {
            let x = mask.trailing_zeros() as usize;
            col_empty[x] |= 1 << y;
            mask &= mask - 1;
        }
    }
    let mut run_empty = col_empty[0].count_ones();
    for x in 0..9usize {
        if col_empty[x] & col_empty[x + 1] != 0 {
            run_empty += col_empty[x + 1].count_ones();
        } else {
            if run_empty % 4 != 0 {
                return true;
            }
            run_empty = col_empty[x + 1].count_ones();
        }
    }
    run_empty % 4 != 0
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct Placement {
    pub piece: Piece,
    pub orientation: u8,
    pub x: i8,
    pub y: i8,
    pub board: u64,
    pub raw_board: u64,
    pub cells: u64,
}

#[cfg(test)]
#[inline]
fn collides(board: u64, p: Piece, o: u8, x: i8, y: i8, height: u8) -> bool {
    if x < 0 || x > MAX_X[p as usize][o as usize] || y < 0 || y > height as i8 + 1 {
        return true;
    }
    for &(dx, dy) in &CELLS[p as usize][o as usize] {
        let xx = x + dx;
        let yy = y + dy;
        if !(0..10).contains(&xx) || yy < 0 {
            return true;
        }
        if yy < height as i8 && board & (1u64 << (yy as u32 * 10 + xx as u32)) != 0 {
            return true;
        }
    }
    false
}
#[inline]
fn place_bits(p: Piece, o: u8, x: i8, y: i8) -> u64 {
    let mut bits = 0;
    for &(dx, dy) in &CELLS[p as usize][o as usize] {
        bits |= 1u64 << ((y + dy) as u32 * 10 + (x + dx) as u32)
    }
    bits
}

#[inline]
fn shift_anchor(bits: u128, delta: i32) -> u128 {
    if delta >= 0 {
        bits.checked_shl(delta as u32).unwrap_or(0)
    } else {
        bits.checked_shr((-delta) as u32).unwrap_or(0)
    }
}

#[inline]
fn board_to_anchor_space(board: u64, height: u8) -> u128 {
    let mut out = 0u128;
    for y in 0..height {
        out |= (((board >> (y as u32 * 10)) & FULL_ROW) as u128) << (y as u32 * 16);
    }
    out
}
#[inline]
fn anchor_bounds(max_x: i8, max_y: i8) -> u128 {
    let row = (1u128 << (max_x as u32 + 1)) - 1;
    let mut out = 0u128;
    for y in 0..=max_y {
        out |= row << (y as u32 * 16);
    }
    out
}
fn valid_anchor_masks(board: u64, p: Piece, height: u8) -> ([u128; 4], [u128; 4]) {
    let occupied = board_to_anchor_space(board, height);
    let mut valid = [0u128; 4];
    let mut inside = [0u128; 4];
    for o in 0..4usize {
        let bounds = anchor_bounds(MAX_X[p as usize][o], height as i8 + 1);
        let mut blocked = 0u128;
        for &(dx, dy) in &CELLS[p as usize][o] {
            blocked |= shift_anchor(occupied, -(dx as i32 + dy as i32 * ANCHOR_STRIDE));
        }
        valid[o] = bounds & !blocked;
        let max_inside_y = height as i8 - 1 - MAX_Y[p as usize][o];
        if max_inside_y >= 0 {
            inside[o] = anchor_bounds(MAX_X[p as usize][o], max_inside_y);
        }
    }
    (valid, inside)
}
// Expand only anchors that became reachable in the previous step.  This keeps
// the same movement graph as the fixed-point implementation while avoiding
// repeated rescans of the entire reached set.
fn add_rotation_frontier(
    p: Piece,
    frontier: &[u128; 4],
    reach: &[u128; 4],
    valid: &[u128; 4],
    physics: Physics,
) -> [u128; 4] {
    let mut out = [0u128; 4];
    if p == Piece::O {
        return out;
    }
    for o in 0..4usize {
        if frontier[o] == 0 {
            continue;
        }
        for dir in [1i8, -1, 2] {
            let no = ((o as i8
                + if dir == 2 {
                    2
                } else if dir == 1 {
                    1
                } else {
                    3
                })
                & 3) as usize;
            let mut remaining = frontier[o];
            if dir == 2 {
                let half: &[(i8, i8)] = match physics {
                    Physics::Jstris => &HALF[o],
                    Physics::Tetrio => &TETRIO_HALF[o],
                };
                for &(dx, dy) in half {
                    let delta = dx as i32 + dy as i32 * ANCHOR_STRIDE;
                    let src_ok = remaining & shift_anchor(valid[no], -delta);
                    if src_ok != 0 {
                        out[no] |= shift_anchor(src_ok, delta) & !reach[no];
                        remaining &= !src_ok;
                    }
                }
            } else {
                let kicks = &if p == Piece::I {
                    match physics {
                        Physics::Jstris => {
                            if dir == 1 {
                                I_CW
                            } else {
                                I_CCW
                            }
                        }
                        Physics::Tetrio => {
                            if dir == 1 {
                                TETRIO_I_CW
                            } else {
                                TETRIO_I_CCW
                            }
                        }
                    }
                } else if dir == 1 {
                    JLSTZ_CW
                } else {
                    JLSTZ_CCW
                };
                for &(dx, dy) in &kicks[o] {
                    let delta = dx as i32 + dy as i32 * ANCHOR_STRIDE;
                    let src_ok = remaining & shift_anchor(valid[no], -delta);
                    if src_ok != 0 {
                        out[no] |= shift_anchor(src_ok, delta) & !reach[no];
                        remaining &= !src_ok;
                    }
                }
            }
        }
    }
    out
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
struct ExactState {
    o: u8,
    x: i8,
    y: i8,
}

// SFinder cover checks exact locks in the SRS-origin coordinate system.  Keep
// this separate from the bounding-box representation used by the fast PC
// vector solver so cover kick priorities are reproduced without touching the
// real-time hot path.
const ORIGIN_SPAWN: [[(i8, i8); 4]; 7] = [
    [(0, 0), (-1, 0), (1, 0), (2, 0)],  // I
    [(0, 0), (-1, 0), (1, 0), (-1, 1)], // J
    [(0, 0), (-1, 0), (1, 0), (1, 1)],  // L
    [(0, 0), (1, 0), (0, 1), (1, 1)],   // O
    [(0, 0), (-1, 0), (0, 1), (1, 1)],  // S
    [(0, 0), (-1, 0), (1, 0), (0, 1)],  // T
    [(0, 0), (1, 0), (0, 1), (-1, 1)],  // Z
];

const fn rotate_origin_cell((x, y): (i8, i8), o: usize) -> (i8, i8) {
    match o & 3 {
        0 => (x, y),
        1 => (y, -x),
        2 => (-x, -y),
        _ => (-y, x),
    }
}

const fn build_origin_cells() -> [[[(i8, i8); 4]; 4]; 7] {
    let mut out = [[[(0, 0); 4]; 4]; 7];
    let mut p = 0;
    while p < 7 {
        let mut o = 0;
        while o < 4 {
            let mut i = 0;
            while i < 4 {
                out[p][o][i] = rotate_origin_cell(ORIGIN_SPAWN[p][i], o);
                i += 1;
            }
            o += 1;
        }
        p += 1;
    }
    out
}

const ORIGIN_CELLS: [[[(i8, i8); 4]; 4]; 7] = build_origin_cells();

const fn build_origin_bounds() -> [[(i8, i8, i8, i8); 4]; 7] {
    let mut out = [[(0, 0, 0, 0); 4]; 7];
    let mut p = 0;
    while p < 7 {
        let mut o = 0;
        while o < 4 {
            let mut min_x = 99;
            let mut max_x = -99;
            let mut min_y = 99;
            let mut max_y = -99;
            let mut i = 0;
            while i < 4 {
                let (x, y) = ORIGIN_CELLS[p][o][i];
                if x < min_x {
                    min_x = x;
                }
                if x > max_x {
                    max_x = x;
                }
                if y < min_y {
                    min_y = y;
                }
                if y > max_y {
                    max_y = y;
                }
                i += 1;
            }
            out[p][o] = (min_x, max_x, min_y, max_y);
            o += 1;
        }
        p += 1;
    }
    out
}

const ORIGIN_BOUNDS: [[(i8, i8, i8, i8); 4]; 7] = build_origin_bounds();

#[inline]
fn origin_pos(p: Piece, o: u8, i: usize) -> (i8, i8) {
    ORIGIN_CELLS[p as usize][(o & 3) as usize][i]
}
#[inline]
fn origin_bounds(p: Piece, o: u8) -> (i8, i8, i8, i8) {
    ORIGIN_BOUNDS[p as usize][(o & 3) as usize]
}
#[inline]
fn origin_collides(board: u64, p: Piece, o: u8, x: i8, y: i8, height: u8) -> bool {
    for i in 0..4 {
        let (dx, dy) = origin_pos(p, o, i);
        let xx = x + dx;
        let yy = y + dy;
        if !(0..10).contains(&xx) || yy < 0 {
            return true;
        }
        if yy < height as i8 && board & (1u64 << (yy as u32 * 10 + xx as u32)) != 0 {
            return true;
        }
    }
    false
}
#[inline]
fn origin_mask(p: Piece, o: u8, x: i8, y: i8, height: u8) -> Option<u64> {
    let mut m = 0u64;
    for i in 0..4 {
        let (dx, dy) = origin_pos(p, o, i);
        let xx = x + dx;
        let yy = y + dy;
        if !(0..10).contains(&xx) || yy < 0 || yy >= height as i8 {
            return None;
        }
        m |= 1u64 << (yy as u32 * 10 + xx as u32);
    }
    Some(m)
}

const RAW_J_CW: [[(i8, i8); 5]; 4] = [
    [(0, 0), (-1, 0), (-1, 1), (0, -2), (-1, -2)],
    [(0, 0), (1, 0), (1, -1), (0, 2), (1, 2)],
    [(0, 0), (1, 0), (1, 1), (0, -2), (1, -2)],
    [(0, 0), (-1, 0), (-1, -1), (0, 2), (-1, 2)],
];
const RAW_J_CCW: [[(i8, i8); 5]; 4] = [
    [(0, 0), (1, 0), (1, 1), (0, -2), (1, -2)],
    [(0, 0), (1, 0), (1, -1), (0, 2), (1, 2)],
    [(0, 0), (-1, 0), (-1, 1), (0, -2), (-1, -2)],
    [(0, 0), (-1, 0), (-1, -1), (0, 2), (-1, 2)],
];
const RAW_J_180_JSTRIS: [[(i8, i8); 2]; 4] = [
    [(0, 0), (0, 1)],
    [(0, 0), (1, 0)],
    [(0, 0), (0, -1)],
    [(0, 0), (-1, 0)],
];
const RAW_J_180_TETRIO: [[(i8, i8); 6]; 4] = [
    [(0, 0), (0, 1), (1, 1), (-1, 1), (1, 0), (-1, 0)],
    [(0, 0), (1, 0), (1, 2), (1, 1), (0, 2), (0, 1)],
    [(0, 0), (0, -1), (-1, -1), (1, -1), (-1, 0), (1, 0)],
    [(0, 0), (-1, 0), (-1, 2), (-1, 1), (0, 2), (0, 1)],
];
const RAW_I_CW: [[(i8, i8); 5]; 4] = [
    [(1, 0), (-1, 0), (2, 0), (-1, -1), (2, 2)],
    [(0, -1), (-1, -1), (2, -1), (-1, 1), (2, -2)],
    [(-1, 0), (1, 0), (-2, 0), (1, 1), (-2, -2)],
    [(0, 1), (1, 1), (-2, 1), (1, -1), (-2, 2)],
];
// Exact per-orientation CCW rows from the properties files: NW, EN, SE, WS.
const RAW_I_CCW: [[(i8, i8); 5]; 4] = [
    // N -> W (I.NW)
    [(0, -1), (-1, -1), (2, -1), (-1, 1), (2, -2)],
    // E -> N (I.EN)
    [(-1, 0), (1, 0), (-2, 0), (1, 1), (-2, -2)],
    // S -> E (I.SE)
    [(0, 1), (1, 1), (-2, 1), (1, -1), (-2, 2)],
    // W -> S (I.WS)
    [(1, 0), (-1, 0), (2, 0), (-1, -1), (2, 2)],
];
const RAW_I_CCW_TETRIO: [[(i8, i8); 5]; 4] = [
    // N -> W (I.NW)
    [(0, -1), (-1, -1), (2, -1), (2, -2), (-1, 1)],
    // E -> N (I.EN)
    [(-1, 0), (-2, 0), (1, 0), (-2, -2), (1, 1)],
    // S -> E (I.SE)
    [(0, 1), (-2, 1), (1, 1), (-2, 2), (1, -1)],
    // W -> S (I.WS)
    [(1, 0), (2, 0), (-1, 0), (2, 2), (-1, -1)],
];
const RAW_I_180: [[(i8, i8); 2]; 4] = [
    [(1, -1), (1, 0)],
    [(-1, -1), (0, -1)],
    [(-1, 1), (-1, 0)],
    [(1, 1), (0, 1)],
];
const RAW_O_CW: [[(i8, i8); 1]; 4] = [[(0, 1)], [(1, 0)], [(0, -1)], [(-1, 0)]];
const RAW_O_CCW: [[(i8, i8); 1]; 4] = [[(1, 0)], [(0, -1)], [(-1, 0)], [(0, 1)]];
const RAW_O_180: [[(i8, i8); 1]; 4] = [[(1, 1)], [(1, -1)], [(-1, -1)], [(-1, 1)]];

fn raw_kicks(p: Piece, o: usize, dir: i8, physics: Physics) -> &'static [(i8, i8)] {
    if p == Piece::O {
        return if dir == 2 {
            &RAW_O_180[o]
        } else if dir == 1 {
            &RAW_O_CW[o]
        } else {
            &RAW_O_CCW[o]
        };
    }
    if p == Piece::I {
        if dir == 2 {
            return &RAW_I_180[o];
        }
        if dir == 1 {
            return &RAW_I_CW[o];
        }
        return match physics {
            Physics::Jstris => &RAW_I_CCW[o],
            Physics::Tetrio => &RAW_I_CCW_TETRIO[o],
        };
    }
    if dir == 2 {
        return match physics {
            Physics::Jstris => &RAW_J_180_JSTRIS[o],
            Physics::Tetrio => &RAW_J_180_TETRIO[o],
        };
    }
    if dir == 1 {
        &RAW_J_CW[o]
    } else {
        &RAW_J_CCW[o]
    }
}
fn origin_rotate_forward(
    board: u64,
    p: Piece,
    st: ExactState,
    dir: i8,
    height: u8,
    physics: Physics,
) -> Option<ExactState> {
    let no = ((st.o as i8
        + if dir == 2 {
            2
        } else if dir == 1 {
            1
        } else {
            3
        })
        & 3) as u8;
    for &(dx, dy) in raw_kicks(p, st.o as usize, dir, physics) {
        let n = ExactState {
            o: no,
            x: st.x + dx,
            y: st.y + dy,
        };
        if !origin_collides(board, p, no, n.x, n.y, height) {
            return Some(n);
        }
    }
    None
}
fn origin_harddrop_reachable(
    board: u64,
    p: Piece,
    st: ExactState,
    height: u8,
    appear_y: i8,
) -> bool {
    let (_, _, _, max_y) = origin_bounds(p, st.o);
    let mut y = st.y + 1;
    let limit = appear_y - max_y;
    while y <= limit {
        if origin_collides(board, p, st.o, st.x, y, height) {
            return false;
        }
        y += 1;
    }
    true
}

const EXACT_X_MIN: i8 = -4;
const EXACT_X_MAX: i8 = 13;
const EXACT_Y_MIN: i8 = -4;
const EXACT_Y_MAX: i8 = 31;
const EXACT_X_COUNT: usize = (EXACT_X_MAX - EXACT_X_MIN + 1) as usize;
const EXACT_Y_COUNT: usize = (EXACT_Y_MAX - EXACT_Y_MIN + 1) as usize;
const EXACT_STATE_COUNT: usize = 4 * EXACT_X_COUNT * EXACT_Y_COUNT;
const EXACT_SEEN_WORDS: usize = EXACT_STATE_COUNT.div_ceil(64);

#[inline]
fn exact_state_id(st: ExactState) -> Option<usize> {
    if !(EXACT_X_MIN..=EXACT_X_MAX).contains(&st.x) || !(EXACT_Y_MIN..=EXACT_Y_MAX).contains(&st.y)
    {
        return None;
    }
    let x = (st.x - EXACT_X_MIN) as usize;
    let y = (st.y - EXACT_Y_MIN) as usize;
    Some((st.o as usize & 3) * EXACT_X_COUNT * EXACT_Y_COUNT + y * EXACT_X_COUNT + x)
}

#[inline]
fn push_exact_unseen(
    stack: &mut [ExactState; EXACT_STATE_COUNT],
    stack_len: &mut usize,
    seen: &mut [u64; EXACT_SEEN_WORDS],
    st: ExactState,
) {
    let Some(id) = exact_state_id(st) else {
        return;
    };
    let word = id >> 6;
    let bit = 1u64 << (id & 63);
    if seen[word] & bit != 0 {
        return;
    }
    seen[word] |= bit;
    stack[*stack_len] = st;
    *stack_len += 1;
}

fn origin_state_reachable(
    board: u64,
    p: Piece,
    starts: &[ExactState],
    height: u8,
    physics: Physics,
) -> bool {
    let appear_y = 24i8;
    let mut stack = [ExactState { o: 0, x: 0, y: 0 }; EXACT_STATE_COUNT];
    let mut stack_len = 0usize;
    let mut seen = [0u64; EXACT_SEEN_WORDS];
    for &st in starts {
        push_exact_unseen(&mut stack, &mut stack_len, &mut seen, st);
    }
    while stack_len != 0 {
        stack_len -= 1;
        let st = stack[stack_len];
        let (_, _, _, max_y) = origin_bounds(p, st.o);
        if st.y + max_y >= appear_y || origin_harddrop_reachable(board, p, st, height, appear_y) {
            return true;
        }
        let up = ExactState {
            o: st.o,
            x: st.x,
            y: st.y + 1,
        };
        if !origin_collides(board, p, up.o, up.x, up.y, height) {
            push_exact_unseen(&mut stack, &mut stack_len, &mut seen, up);
        }
        for nx in [st.x - 1, st.x + 1] {
            let n = ExactState {
                o: st.o,
                x: nx,
                y: st.y,
            };
            if !origin_collides(board, p, n.o, n.x, n.y, height) {
                push_exact_unseen(&mut stack, &mut stack_len, &mut seen, n);
            }
        }
        for dir in [1i8, -1, 2] {
            let po = ((st.o as i8
                - if dir == 2 {
                    2
                } else if dir == 1 {
                    1
                } else {
                    3
                })
                & 3) as u8;
            for &(dx, dy) in raw_kicks(p, po as usize, dir, physics) {
                let prev = ExactState {
                    o: po,
                    x: st.x - dx,
                    y: st.y - dy,
                };
                if origin_collides(board, p, po, prev.x, prev.y, height) {
                    continue;
                }
                if origin_rotate_forward(board, p, prev, dir, height, physics) == Some(st) {
                    push_exact_unseen(&mut stack, &mut stack_len, &mut seen, prev);
                }
            }
        }
    }
    false
}

#[inline]
fn corner_block(board: u64, x: i8, y: i8, height: u8) -> bool {
    if !(0..10).contains(&x) || y < 0 {
        return true;
    }
    if y >= height as i8 {
        return false;
    }
    board & (1u64 << (y as u32 * 10 + x as u32)) != 0
}
#[inline]
fn t_front_filled(board: u64, st: ExactState, height: u8) -> bool {
    match st.o & 3 {
        0 => {
            corner_block(board, st.x - 1, st.y + 1, height)
                && corner_block(board, st.x + 1, st.y + 1, height)
        }
        2 => {
            corner_block(board, st.x - 1, st.y - 1, height)
                && corner_block(board, st.x + 1, st.y - 1, height)
        }
        3 => {
            corner_block(board, st.x - 1, st.y - 1, height)
                && corner_block(board, st.x - 1, st.y + 1, height)
        }
        _ => {
            corner_block(board, st.x + 1, st.y - 1, height)
                && corner_block(board, st.x + 1, st.y + 1, height)
        }
    }
}
/// 0 = not a T-spin, 1 = Mini, 2 = Regular.  This mirrors the spin checks used
/// by SFinder cover for the default starting-B2B=0 wrapper contract.
pub fn tspin_kind_exact(board: u64, target_cells: u64, height: u8, physics: Physics) -> u8 {
    let p = Piece::T;
    let mut targets = [ExactState { o: 0, x: 0, y: 0 }; 16];
    let mut target_len = 0usize;
    for o in 0..4u8 {
        let (min_x, max_x, min_y, max_y) = origin_bounds(p, o);
        for y in -min_y..height as i8 - max_y {
            for x in -min_x..10 - max_x {
                if origin_mask(p, o, x, y, height) == Some(target_cells)
                    && !origin_collides(board, p, o, x, y, height)
                    && target_len < targets.len()
                {
                    targets[target_len] = ExactState { o, x, y };
                    target_len += 1;
                }
            }
        }
    }
    let mut best = 0u8;
    for &st in &targets[..target_len] {
        let corners = [
            corner_block(board, st.x - 1, st.y - 1, height),
            corner_block(board, st.x - 1, st.y + 1, height),
            corner_block(board, st.x + 1, st.y - 1, height),
            corner_block(board, st.x + 1, st.y + 1, height),
        ];
        if corners.into_iter().filter(|&x| x).count() < 3 {
            continue;
        }
        let front = t_front_filled(board, st, height);
        for dir in [1i8, -1, 2] {
            let po = ((st.o as i8
                - if dir == 2 {
                    2
                } else if dir == 1 {
                    1
                } else {
                    3
                })
                & 3) as u8;
            for (idx, &(dx, dy)) in raw_kicks(p, po as usize, dir, physics).iter().enumerate() {
                let prev = ExactState {
                    o: po,
                    x: st.x - dx,
                    y: st.y - dy,
                };
                let (_, _, min_y, max_y) = origin_bounds(p, po);
                if prev.y + min_y < 0
                    || prev.y + max_y >= height as i8
                    || origin_collides(board, p, po, prev.x, prev.y, height)
                {
                    continue;
                }
                if origin_rotate_forward(board, p, prev, dir, height, physics) != Some(st) {
                    continue;
                }
                if !origin_state_reachable(board, p, &[prev], height, physics) {
                    continue;
                }
                let privilege = dir != 2 && idx == 4 && (po & 1) == 0;
                let kind = if front || privilege { 2 } else { 1 };
                best = best.max(kind);
                if best == 2 {
                    return 2;
                }
            }
        }
    }
    best
}

/// SFinder-cover style reverse locked reachability for one exact operation.
pub fn reachable_exact_locked(
    board: u64,
    p: Piece,
    target_cells: u64,
    height: u8,
    physics: Physics,
) -> bool {
    let mut starts = [ExactState { o: 0, x: 0, y: 0 }; 16];
    let mut start_len = 0usize;
    for o in 0..4u8 {
        let (min_x, max_x, min_y, max_y) = origin_bounds(p, o);
        for y in -min_y..height as i8 - max_y {
            for x in -min_x..10 - max_x {
                if origin_mask(p, o, x, y, height) == Some(target_cells)
                    && !origin_collides(board, p, o, x, y, height)
                {
                    if start_len == starts.len() {
                        return false;
                    }
                    starts[start_len] = ExactState { o, x, y };
                    start_len += 1;
                }
            }
        }
    }
    origin_state_reachable(board, p, &starts[..start_len], height, physics)
}

pub fn reachable_placements_with_physics(
    board: u64,
    p: Piece,
    height: u8,
    physics: Physics,
) -> Vec<Placement> {
    let (valid, inside) = valid_anchor_masks(board, p, height);
    // reach[o] is always a subset of valid[o], and emitted locks are also
    // restricted by inside[o]. If no orientation has any valid in-board anchor,
    // the frontier can never produce a locked placement.
    if (0..4).all(|o| valid[o] & inside[o] == 0) {
        return Vec::new();
    }
    let mut reach = [0u128; 4];
    let spawn_rows =
        (0xffffu128 << (height as u32 * 16)) | (0xffffu128 << ((height as u32 + 1) * 16));
    for o in 0..4 {
        reach[o] = valid[o] & spawn_rows
    }
    let mut frontier = reach;
    while frontier.iter().any(|&x| x != 0) {
        let mut next = [0u128; 4];
        for o in 0..4 {
            next[o] |= ((frontier[o] << 1) | (frontier[o] >> 1) | (frontier[o] >> 16))
                & valid[o]
                & !reach[o];
        }
        let rotated = add_rotation_frontier(p, &frontier, &reach, &valid, physics);
        for o in 0..4 {
            next[o] |= rotated[o] & !reach[o];
            reach[o] |= next[o];
        }
        frontier = next;
    }
    let mask = board_mask(height);
    let mut out = Vec::with_capacity(48);
    let mut dedup: FastSet<(u64, u8, i8, i8)> = FastSet::default();
    for o in 0..4usize {
        let downable = valid[o] << 16;
        let mut locks = reach[o] & inside[o] & !downable;
        while locks != 0 {
            let bit = locks.trailing_zeros();
            locks &= locks - 1;
            let y = (bit / 16) as i8;
            let x = (bit % 16) as i8;
            let bits = place_bits(p, o as u8, x, y);
            if bits & board != 0 || bits & !mask != 0 {
                continue;
            }
            let raw = board | bits;
            let next = normalize_after_placement(raw, height);
            let co = match p {
                Piece::O => 0,
                Piece::I | Piece::S | Piece::Z => (o as u8) & 1,
                _ => o as u8,
            };
            if dedup.insert((next, co, x, y)) {
                out.push(Placement {
                    piece: p,
                    orientation: o as u8,
                    x,
                    y,
                    board: next,
                    raw_board: raw,
                    cells: bits,
                })
            }
        }
    }
    out
}

pub fn reachable_placements(board: u64, p: Piece, height: u8) -> Vec<Placement> {
    reachable_placements_with_physics(board, p, height, Physics::Jstris)
}

#[cfg(test)]
fn reachable_placements_bfs(board: u64, p: Piece, height: u8) -> Vec<Placement> {
    use std::collections::VecDeque;
    #[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
    struct State {
        o: u8,
        x: i8,
        y: i8,
    }
    fn rotate(board: u64, p: Piece, s: State, dir: i8, height: u8) -> Option<State> {
        if p == Piece::O {
            return None;
        }
        let no = ((s.o as i8
            + if dir == 2 {
                2
            } else if dir == 1 {
                1
            } else {
                3
            })
            & 3) as u8;
        if dir == 2 {
            for &(dx, dy) in &HALF[s.o as usize] {
                let n = State {
                    o: no,
                    x: s.x + dx,
                    y: s.y + dy,
                };
                if !collides(board, p, no, n.x, n.y, height) {
                    return Some(n);
                }
            }
        } else {
            let kicks = &if p == Piece::I {
                if dir == 1 { I_CW } else { I_CCW }
            } else if dir == 1 {
                JLSTZ_CW
            } else {
                JLSTZ_CCW
            };
            for &(dx, dy) in &kicks[s.o as usize] {
                let n = State {
                    o: no,
                    x: s.x + dx,
                    y: s.y + dy,
                };
                if !collides(board, p, no, n.x, n.y, height) {
                    return Some(n);
                }
            }
        }
        None
    }
    let mut q = VecDeque::new();
    let mut seen = HashSet::new();
    for o in 0..4u8 {
        for y in height as i8..=height as i8 + 1 {
            for x in 0..=MAX_X[p as usize][o as usize] {
                let s = State { o, x, y };
                if !collides(board, p, o, x, y, height) && seen.insert(s) {
                    q.push_back(s)
                }
            }
        }
    }
    let mask = board_mask(height);
    let mut out = Vec::new();
    let mut dedup = HashSet::new();
    while let Some(s) = q.pop_front() {
        if s.y + MAX_Y[p as usize][s.o as usize] < height as i8
            && collides(board, p, s.o, s.x, s.y - 1, height)
        {
            let bits = place_bits(p, s.o, s.x, s.y);
            if bits & board == 0 && bits & !mask == 0 {
                let raw = board | bits;
                let next = normalize_after_placement(raw, height);
                let co = match p {
                    Piece::O => 0,
                    Piece::I | Piece::S | Piece::Z => s.o & 1,
                    _ => s.o,
                };
                if dedup.insert((next, co, s.x, s.y)) {
                    out.push(Placement {
                        piece: p,
                        orientation: s.o,
                        x: s.x,
                        y: s.y,
                        board: next,
                        raw_board: raw,
                        cells: bits,
                    })
                }
            }
        }
        for n in [
            State {
                o: s.o,
                x: s.x - 1,
                y: s.y,
            },
            State {
                o: s.o,
                x: s.x + 1,
                y: s.y,
            },
            State {
                o: s.o,
                x: s.x,
                y: s.y - 1,
            },
        ] {
            if !collides(board, p, n.o, n.x, n.y, height) && seen.insert(n) {
                q.push_back(n)
            }
        }
        for d in [1, -1, 2] {
            if let Some(n) = rotate(board, p, s, d, height)
                && seen.insert(n)
            {
                q.push_back(n)
            }
        }
    }
    out
}

#[derive(Clone)]
struct PlacementSet {
    placements: Rc<[Placement]>,
    next: Rc<[u64]>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct Solution {
    pub masks: [u64; 7],
    pub order_count: u32,
}

#[derive(Clone, Debug)]
pub struct PatternSolutionCoverage {
    pub solution: Solution,
    // (case index, number of distinct playable piece orders for this solution)
    pub cases: Vec<(u32, u32)>,
}

// Search topology and solution colouring are deliberately separate.  A DAG
// node contains only information that can affect the future; past piece masks
// are carried by edges and reconstructed after the structural search.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
struct StructuralState {
    board: u64,
    idx: u8,
    hold: u8,
    placed: u8,
}

// Compatibility-mode pattern enumeration separates geometry from queue order.
// `remaining_counts` packs seven 4-bit piece counters (I,J,L,O,S,T,Z).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
struct MultisetState {
    board: u64,
    remaining_counts: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
struct CompatPlacementCacheKey {
    board: u64,
    piece: Piece,
}

trait CompletionKey {
    type Key: Copy + Eq + Hash;
    fn make(board: u64, qlen: u8, hold: u8) -> Self::Key;
}

struct FastCompletionKey;
impl CompletionKey for FastCompletionKey {
    type Key = u64;
    #[inline]
    fn make(board: u64, qlen: u8, hold: u8) -> u64 {
        board | ((qlen as u64) << 40) | ((hold as u64) << 45)
    }
}

struct CompatCompletionKey;
impl CompletionKey for CompatCompletionKey {
    type Key = u128;
    #[inline]
    fn make(board: u64, qlen: u8, hold: u8) -> u128 {
        (board as u128) | ((qlen as u128) << 60) | ((hold as u128) << 65)
    }
}

// The edge stores the placement in the normalized current-board coordinate
// system.  Original-row colouring is intentionally not part of the DAG: it is
// reconstructed per successful path because different histories can reach the
// same future state after line clears.
#[derive(Clone, Copy, Debug)]
struct DagEdge {
    raw_board: u64,
    next: u32,
    piece: Piece,
    orientation: u8,
    x: i8,
    y: i8,
    // 0..6 only on terminal edges when the supplied concrete queue has
    // exactly one unplaced piece left; 7 means not applicable.
    saved: u8,
}

// Structural search and pattern-level compatibility search share one flat
// edge arena. This keeps allocation/cache behaviour consistent across every
// wrapper and avoids one Vec allocation per DAG node.
#[derive(Clone, Copy, Debug, Default)]
struct FlatDagNode {
    edge_start: u32,
    edge_len: u32,
}

#[derive(Debug, Default)]
struct FlatDag {
    nodes: Vec<FlatDagNode>,
    edges: Vec<DagEdge>,
    productive: Vec<u8>,
}
impl FlatDag {
    #[inline]
    fn edges(&self, node: u32) -> &[DagEdge] {
        let meta = self.nodes[node as usize];
        let start = meta.edge_start as usize;
        &self.edges[start..start + meta.edge_len as usize]
    }
}

const NO_TRIE_CHILD: u32 = u32::MAX;

#[derive(Clone, Copy, Debug)]
struct QueueTrieNode {
    children: [u32; 7],
    // DFS-preorder interval invariant: perm[dfs_lo..dfs_hi] are all original
    // case IDs in this node's subtree; perm[dfs_lo..dfs_lo+terminal_len] are
    // this node's own terminals only (used for ended-state coverage).
    dfs_lo: u32,
    dfs_hi: u32,
    terminal_len: u32,
}
impl Default for QueueTrieNode {
    fn default() -> Self {
        Self {
            children: [NO_TRIE_CHILD; 7],
            dfs_lo: 0,
            dfs_hi: 0,
            terminal_len: 0,
        }
    }
}

// Prefix-sharing Hold automaton for pattern-level coverage projection. Each
// normal trie position represents every concrete queue with that prefix; an
// ended position narrows the state to queues ending at exactly that node.
//
// Terminals are emitted in deterministic DFS preorder (own terminals first,
// then children in piece-index order I..Z), so every subtree is a contiguous
// perm[dfs_lo..dfs_hi) interval. perm[i] maps DFS index i to the original
// caller-supplied case ID.
struct QueueTrie {
    nodes: Vec<QueueTrieNode>,
    perm: Vec<u32>,
    words: usize,
}

struct QueueTrieScratch {
    state_seen: Vec<u32>,
    position_seen: Vec<u32>,
    cur: Vec<u32>,
    next: Vec<u32>,
    generation: u32,
}
impl QueueTrieScratch {
    fn new(node_count: usize) -> Self {
        Self {
            state_seen: vec![0u32; node_count * 16],
            position_seen: vec![0u32; node_count * 2],
            cur: Vec::with_capacity(256),
            next: Vec::with_capacity(256),
            generation: 0,
        }
    }

    fn next_generation(&mut self) -> u32 {
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.state_seen.fill(0);
            self.position_seen.fill(0);
            self.generation = 1;
        }
        self.generation
    }
}

impl QueueTrie {
    fn new(qbits: &[u64], qlens: &[u8]) -> Option<Self> {
        if qbits.len() != qlens.len() {
            return None;
        }
        let mut nodes = vec![QueueTrieNode::default()];
        let mut terminal_pairs = Vec::with_capacity(qbits.len());
        for (case, (&bits, &len)) in qbits.iter().zip(qlens).enumerate() {
            let mut node = 0u32;
            for index in 0..len {
                let piece = PcSolver::packed_piece(bits, index)? as usize;
                let child = nodes[node as usize].children[piece];
                node = if child == NO_TRIE_CHILD {
                    let child = nodes.len() as u32;
                    nodes.push(QueueTrieNode::default());
                    nodes[node as usize].children[piece] = child;
                    child
                } else {
                    child
                };
            }
            terminal_pairs.push((node, case as u32));
        }
        // Sort by (node, case) so each node's own terminals are in ascending
        // case-ID order within their DFS-preorder slice.
        terminal_pairs.sort_unstable_by_key(|&(node, case)| (node, case));

        // Build per-node terminal ranges into terminal_pairs.
        let n = nodes.len();
        let mut node_term_start = vec![0usize; n];
        let mut node_term_end = vec![0usize; n];
        {
            let mut i = 0usize;
            while i < terminal_pairs.len() {
                let node = terminal_pairs[i].0 as usize;
                node_term_start[node] = i;
                while i < terminal_pairs.len() && terminal_pairs[i].0 as usize == node {
                    i += 1;
                }
                node_term_end[node] = i;
            }
        }

        // DFS preorder emission: for each node, first emit own terminals, then
        // recurse into children (piece-index order I..Z). This makes every
        // subtree a contiguous perm[] interval.
        let mut perm = Vec::with_capacity(qbits.len());
        Self::dfs_emit(
            &mut nodes,
            &terminal_pairs,
            &node_term_start,
            &node_term_end,
            0,
            &mut perm,
        );

        let words = qbits.len().div_ceil(64);
        Some(Self { nodes, perm, words })
    }

    fn dfs_emit(
        nodes: &mut Vec<QueueTrieNode>,
        pairs: &[(u32, u32)],
        term_start: &[usize],
        term_end: &[usize],
        node: usize,
        perm: &mut Vec<u32>,
    ) {
        let dfs_lo = perm.len() as u32;
        let ts = term_start[node];
        let te = term_end[node];
        perm.extend(pairs[ts..te].iter().map(|pr| pr.1));
        let terminal_len = (te - ts) as u32;
        // Copy children to avoid conflicting borrows when recursing.
        let children = nodes[node].children;
        for &child in &children {
            if child != NO_TRIE_CHILD {
                Self::dfs_emit(nodes, pairs, term_start, term_end, child as usize, perm);
            }
        }
        nodes[node].dfs_lo = dfs_lo;
        nodes[node].dfs_hi = perm.len() as u32;
        nodes[node].terminal_len = terminal_len;
    }

    // Set bits [lo, hi) in the coverage word slice (all indices are DFS positions).
    #[inline]
    fn set_bit_range(bits: &mut [u64], lo: usize, hi: usize) {
        if lo >= hi {
            return;
        }
        let lo_word = lo / 64;
        let hi_last = hi - 1;
        let hi_word = hi_last / 64;
        if lo_word == hi_word {
            bits[lo_word] |= ((!0u64) << (lo % 64)) & ((!0u64) >> (63 - hi_last % 64));
        } else {
            bits[lo_word] |= (!0u64) << (lo % 64);
            bits[(lo_word + 1)..hi_word].fill(!0u64);
            let hi_mod = hi % 64;
            bits[hi_word] |= if hi_mod == 0 {
                !0u64
            } else {
                (1u64 << hi_mod) - 1
            };
        }
    }

    #[inline]
    fn push_state(next: &mut Vec<u32>, seen: &mut [u32], generation: u32, state: u32) {
        let slot = &mut seen[state as usize];
        if *slot != generation {
            *slot = generation;
            next.push(state);
        }
    }

    #[inline]
    fn normal_state(node: u32, hold: u8) -> u32 {
        (node << 3) | hold as u32
    }

    #[inline]
    fn ended_state(node: u32, hold: u8, node_count: u32) -> u32 {
        ((node_count + node) << 3) | hold as u32
    }

    fn coverage_for_order(
        &self,
        order_bits: u64,
        depth: u8,
        use_hold: bool,
        scratch: &mut QueueTrieScratch,
    ) -> Vec<u64> {
        let node_count = self.nodes.len() as u32;
        scratch.cur.clear();
        scratch.next.clear();
        scratch.cur.push(Self::normal_state(0, 7));

        for step in 0..depth {
            let code = ((order_bits >> (step as u32 * 3)) & 7) as u8;
            if code == 0 {
                return vec![0u64; self.words];
            }
            let wanted = code - 1;
            let generation = scratch.next_generation();
            scratch.next.clear();
            for &state in &scratch.cur {
                let hold = (state & 7) as u8;
                let pos = state >> 3;
                if pos >= node_count {
                    if use_hold && hold == wanted {
                        let node = pos - node_count;
                        Self::push_state(
                            &mut scratch.next,
                            &mut scratch.state_seen,
                            generation,
                            Self::ended_state(node, 7, node_count),
                        );
                    }
                    continue;
                }
                let node = pos;
                let meta = &self.nodes[node as usize];

                let direct = meta.children[wanted as usize];
                if direct != NO_TRIE_CHILD {
                    Self::push_state(
                        &mut scratch.next,
                        &mut scratch.state_seen,
                        generation,
                        Self::normal_state(direct, hold),
                    );
                }
                if !use_hold {
                    continue;
                }

                if hold == 7 {
                    for current in 0..7usize {
                        let first = meta.children[current];
                        if first == NO_TRIE_CHILD {
                            continue;
                        }
                        let second = self.nodes[first as usize].children[wanted as usize];
                        if second != NO_TRIE_CHILD {
                            Self::push_state(
                                &mut scratch.next,
                                &mut scratch.state_seen,
                                generation,
                                Self::normal_state(second, current as u8),
                            );
                        }
                    }
                } else if hold == wanted {
                    for current in 0..7usize {
                        let child = meta.children[current];
                        if child != NO_TRIE_CHILD {
                            Self::push_state(
                                &mut scratch.next,
                                &mut scratch.state_seen,
                                generation,
                                Self::normal_state(child, current as u8),
                            );
                        }
                    }
                    if meta.terminal_len != 0 {
                        Self::push_state(
                            &mut scratch.next,
                            &mut scratch.state_seen,
                            generation,
                            Self::ended_state(node, 7, node_count),
                        );
                    }
                }
            }
            if scratch.next.is_empty() {
                return vec![0u64; self.words];
            }
            std::mem::swap(&mut scratch.cur, &mut scratch.next);
        }

        // Accumulate coverage as a bitmap over DFS positions. Each set bit at
        // position i means perm[i] (an original case ID) is covered. Consumers
        // must map through perm[] before writing public original-case output.
        let mut covered = vec![0u64; self.words];
        let generation = scratch.next_generation();
        for &state in &scratch.cur {
            let pos = state >> 3;
            let slot = &mut scratch.position_seen[pos as usize];
            if *slot == generation {
                continue;
            }
            *slot = generation;
            let (lo, hi) = if pos < node_count {
                let n = &self.nodes[pos as usize];
                (n.dfs_lo as usize, n.dfs_hi as usize)
            } else {
                let n = &self.nodes[(pos - node_count) as usize];
                let lo = n.dfs_lo as usize;
                (lo, lo + n.terminal_len as usize)
            };
            Self::set_bit_range(&mut covered, lo, hi);
        }
        covered
    }
}

const TERMINAL_NODE: u32 = u32::MAX;

// Three board-size planes store a 3-bit piece code (piece + 1) for every
// placed cell. This is 24 bytes instead of carrying seven u64 piece masks
// (56 bytes) through the enumeration path.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Ord, PartialOrd)]
struct CompactSolution {
    planes: [u64; 3],
}

#[derive(Clone, Copy, Debug, Default)]
struct DagPathState {
    depth: u8,
    cleared_rows: u8,
    compact: CompactSolution,
    order_bits: u64,
}
impl CompactSolution {
    #[inline]
    fn with_piece_mask(mut self, piece: Piece, mask: u64) -> Self {
        let code = piece as u8 + 1;
        for bit in 0..3 {
            if code & (1 << bit) != 0 {
                self.planes[bit] |= mask;
            }
        }
        self
    }

    fn masks(self, height: u8) -> [u64; 7] {
        let mut out = [0u64; 7];
        for piece in Piece::ALL {
            let code = piece as u8 + 1;
            let mut mask = board_mask(height);
            for bit in 0..3 {
                if code & (1 << bit) != 0 {
                    mask &= self.planes[bit];
                } else {
                    mask &= !self.planes[bit];
                }
            }
            out[piece as usize] = mask & board_mask(height);
        }
        out
    }
}

// Maps a placement in the normalized current board back to the original rows.
// Unlike the legacy enumerator this returns only the current placement mask;
// previous colouring is not copied into the structural state.
fn map_placement_to_original(
    height: u8,
    cleared_rows: u8,
    piece: Piece,
    orientation: u8,
    x: i8,
    y: i8,
    raw_board: u64,
) -> Option<(u8, u64)> {
    let c = cleared_rows.count_ones() as i8;
    let mut available = [0u8; MAX_HEIGHT as usize];
    let mut an = 0usize;
    for r in 0..height {
        if cleared_rows & (1 << r) == 0 {
            available[an] = r;
            an += 1;
        }
    }
    let mut original_mask = 0u64;
    for &(dx, dy) in &CELLS[piece as usize][orientation as usize] {
        let nx = x + dx;
        let ny = y + dy;
        if ny < c {
            return None;
        }
        let ai = (ny - c) as usize;
        if ai >= an {
            return None;
        }
        let orig = available[ai];
        original_mask |= 1u64 << (orig as u32 * 10 + nx as u32);
    }
    let mut next_cleared = cleared_rows;
    for ny in c..height as i8 {
        if row(raw_board, ny as u8) == FULL_ROW {
            let ai = (ny - c) as usize;
            if ai < an {
                next_cleared |= 1 << available[ai];
            }
        }
    }
    Some((next_cleared, original_mask))
}

#[derive(Default)]
struct PackedBoards {
    data: Vec<u8>,
    len: usize,
}
impl PackedBoards {
    #[inline]
    fn push(&mut self, board: u64) {
        self.data.extend_from_slice(&board.to_le_bytes()[..5]);
        self.len += 1;
    }
    #[inline]
    fn finish(&mut self) {
        self.data.extend_from_slice(&[0; 3]);
    }
    #[inline]
    fn len(&self) -> usize {
        self.len
    }
    #[inline]
    fn get(&self, index: usize) -> u64 {
        debug_assert!(index < self.len);
        let p = index * 5;
        // Three padding bytes appended by finish() make the final unaligned
        // 64-bit load safe; only the low 40 board bits are retained.
        let value = unsafe { (self.data.as_ptr().add(p) as *const u64).read_unaligned() };
        value & ((1u64 << 40) - 1)
    }
    #[inline]
    fn find(&self, board: u64) -> Option<usize> {
        let mut lo = 0usize;
        let mut hi = self.len();
        while lo < hi {
            let mid = (lo + hi) >> 1;
            let value = self.get(mid);
            if value < board {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        (lo < self.len() && self.get(lo) == board).then_some(lo)
    }
    #[inline]
    fn memory_bytes(&self) -> usize {
        self.data.capacity()
    }
}

fn delta_value_count(payload: &[u8]) -> usize {
    payload.iter().filter(|&&b| b & 0x80 == 0).count()
}

fn decode_delta_each(payload: &[u8], mut visit: impl FnMut(u64) -> Option<()>) -> Option<usize> {
    let mut pos = 0usize;
    let mut prev = 0u64;
    let mut count = 0usize;
    while pos < payload.len() {
        let mut shift = 0u32;
        let mut delta = 0u64;
        loop {
            if pos >= payload.len() || shift >= 64 {
                return None;
            }
            let byte = payload[pos];
            pos += 1;
            delta |= ((byte & 0x7f) as u64) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
        }
        let value = prev.checked_add(delta)?;
        if value >> 40 != 0 || (count != 0 && value <= prev) {
            return None;
        }
        visit(value)?;
        prev = value;
        count += 1;
    }
    Some(count)
}

// Stage 7 contains ~2M boards.  Keeping every 40-bit board as five packed
// bytes costs about 10 MiB and a global binary search needs ~21 comparisons.
// Split each board into a 16-bit prefix and 24-bit suffix instead.  The prefix
// table is 65,537 u32 offsets (~256 KiB) and suffixes use three bytes each
// (~6.05 MiB); lookup binary-searches only the matching prefix bucket.
#[derive(Default)]
struct Prefix16Boards24 {
    offsets: Vec<u32>,
    suffixes: Vec<u8>,
    len: usize,
}
impl Prefix16Boards24 {
    fn from_delta(payload: &[u8]) -> Option<Self> {
        let value_count = delta_value_count(payload);
        if value_count == 0 {
            return Some(Self::default());
        }
        let mut counts = vec![0u32; 1 << 16];
        let mut suffixes = Vec::with_capacity(value_count * 3 + 1);
        let decoded = decode_delta_each(payload, |board| {
            let prefix = (board >> 24) as usize;
            counts[prefix] = counts[prefix].checked_add(1)?;
            let bytes = (board as u32).to_le_bytes();
            suffixes.extend_from_slice(&bytes[..3]);
            Some(())
        })?;
        if decoded != value_count {
            return None;
        }
        suffixes.push(0);
        let mut offsets = Vec::with_capacity((1 << 16) + 1);
        offsets.push(0);
        let mut sum = 0u32;
        for count in counts {
            sum = sum.checked_add(count)?;
            offsets.push(sum);
        }
        Some(Self {
            offsets,
            suffixes,
            len: decoded,
        })
    }
    #[inline]
    fn get_suffix(&self, index: usize) -> u32 {
        let p = index * 3;
        let value = unsafe { (self.suffixes.as_ptr().add(p) as *const u32).read_unaligned() };
        value & 0x00ff_ffff
    }
    fn find(&self, board: u64) -> Option<usize> {
        if board >> 40 != 0 || self.offsets.is_empty() {
            return None;
        }
        let prefix = (board >> 24) as usize;
        let suffix = (board & 0x00ff_ffff) as u32;
        let start = self.offsets[prefix] as usize;
        let mut lo = start;
        let mut hi = self.offsets[prefix + 1] as usize;
        while lo < hi {
            let mid = (lo + hi) >> 1;
            if self.get_suffix(mid) < suffix {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        (lo < self.offsets[prefix + 1] as usize && self.get_suffix(lo) == suffix).then_some(lo)
    }
    #[inline]
    fn len(&self) -> usize {
        self.len
    }
    #[inline]
    fn memory_bytes(&self) -> usize {
        self.offsets.capacity() * size_of::<u32>() + self.suffixes.capacity()
    }
}

#[derive(Default)]
enum LegalStage {
    #[default]
    Empty,
    Packed(PackedBoards),
    Prefix16_24(Prefix16Boards24),
}
impl LegalStage {
    fn from_delta(stage: usize, payload: &[u8]) -> Option<Self> {
        let value_count = delta_value_count(payload);
        if value_count == 0 {
            return Some(Self::Empty);
        }
        if stage == 7 {
            return Some(Self::Prefix16_24(Prefix16Boards24::from_delta(payload)?));
        }
        let mut packed = PackedBoards {
            data: Vec::with_capacity(value_count * 5 + 3),
            len: 0,
        };
        let decoded = decode_delta_each(payload, |board| {
            packed.push(board);
            Some(())
        })?;
        if decoded != value_count {
            return None;
        }
        packed.finish();
        Some(Self::Packed(packed))
    }
    #[inline]
    fn len(&self) -> usize {
        match self {
            Self::Empty => 0,
            Self::Packed(x) => x.len(),
            Self::Prefix16_24(x) => x.len(),
        }
    }
    #[inline]
    fn find(&self, board: u64) -> Option<usize> {
        match self {
            Self::Empty => None,
            Self::Packed(x) => x.find(board),
            Self::Prefix16_24(x) => x.find(board),
        }
    }
    #[inline]
    fn contains(&self, board: u64) -> bool {
        self.find(board).is_some()
    }
    #[inline]
    fn memory_bytes(&self) -> usize {
        match self {
            Self::Empty => 0,
            Self::Packed(x) => x.memory_bytes(),
            Self::Prefix16_24(x) => x.memory_bytes(),
        }
    }
}

const ORACLE_STAGE9_PLACEMENTS: u8 = 1;
const ORACLE_STAGE8_PAIR_MASKS: u8 = 2;

pub struct LegalTables {
    stages: [LegalStage; 11],
    // Indexed by stage-9 board index * 7 + piece.  u16::MAX means that piece
    // cannot finish; otherwise bits encode orientation(2), x(4), y(3).
    stage9_finish: Vec<u16>,
    // Indexed by stage-8 board index * 7 + first piece.  Each byte is a
    // 7-piece mask describing which second piece can complete the PC.
    stage8_pair_masks: Vec<u8>,
    version: u8,
}
impl Default for LegalTables {
    fn default() -> Self {
        Self {
            stages: std::array::from_fn(|_| LegalStage::default()),
            stage9_finish: Vec::new(),
            stage8_pair_masks: Vec::new(),
            version: 0,
        }
    }
}
impl LegalTables {
    pub fn from_pack(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 5 || (&bytes[..4] != b"LGB1" && &bytes[..4] != b"LGB2") {
            return None;
        }
        let version = bytes[3] - b'0';
        let mut out = Self {
            version,
            ..Self::default()
        };
        let count = bytes[4] as usize;
        let mut pos = 5usize;
        for _ in 0..count {
            if pos + 5 > bytes.len() {
                return None;
            }
            let stage = bytes[pos] as usize;
            pos += 1;
            let len = u32::from_le_bytes(bytes[pos..pos + 4].try_into().ok()?) as usize;
            pos += 4;
            if stage >= out.stages.len() || pos + len > bytes.len() {
                return None;
            }
            let end = pos + len;
            out.stages[stage] = LegalStage::from_delta(stage, &bytes[pos..end])?;
            pos = end;
        }
        if version >= 2 {
            if pos >= bytes.len() {
                return None;
            }
            let oracle_count = bytes[pos] as usize;
            pos += 1;
            for _ in 0..oracle_count {
                if pos + 6 > bytes.len() {
                    return None;
                }
                let kind = bytes[pos];
                let stage = bytes[pos + 1] as usize;
                pos += 2;
                let len = u32::from_le_bytes(bytes[pos..pos + 4].try_into().ok()?) as usize;
                pos += 4;
                if pos + len > bytes.len() {
                    return None;
                }
                let payload = &bytes[pos..pos + len];
                pos += len;
                match (kind, stage) {
                    (ORACLE_STAGE9_PLACEMENTS, 9) => {
                        if payload.len() != out.stages[9].len() * 7 * 2 {
                            return None;
                        }
                        out.stage9_finish = payload
                            .chunks_exact(2)
                            .map(|x| u16::from_le_bytes([x[0], x[1]]))
                            .collect();
                    }
                    (ORACLE_STAGE8_PAIR_MASKS, 8) => {
                        if payload.len() != out.stages[8].len() * 7 {
                            return None;
                        }
                        out.stage8_pair_masks = payload.to_vec();
                    }
                    _ => return None,
                }
            }
        }
        if pos != bytes.len() {
            return None;
        }
        Some(out)
    }
    #[inline]
    pub fn accepts(&self, board: u64, height: u8) -> bool {
        if height != 4 {
            return true;
        }
        let pc = board.count_ones();
        if !pc.is_multiple_of(4) {
            return true;
        }
        let stage = (pc / 4) as usize;
        if stage >= self.stages.len() || self.stages[stage].len() == 0 {
            return true;
        }
        self.stages[stage].contains(board)
    }
    pub fn count(&self, stage: usize) -> usize {
        self.stages.get(stage).map_or(0, LegalStage::len)
    }
    #[inline]
    fn stage9_finish_code(&self, board: u64, piece: Piece) -> Option<Option<u16>> {
        if self.stage9_finish.is_empty() {
            return None;
        }
        let index = self.stages[9].find(board)?;
        let code = self.stage9_finish[index * 7 + piece as usize];
        Some((code != u16::MAX).then_some(code))
    }
    fn stage9_finish_placement(&self, board: u64, piece: Piece) -> Option<Option<Placement>> {
        let Some(code) = self.stage9_finish_code(board, piece) else {
            return if self.stage9_finish.is_empty() {
                None
            } else {
                Some(None)
            };
        };
        let Some(code) = code else {
            return Some(None);
        };
        let orientation = (code & 3) as u8;
        let x = ((code >> 2) & 0xf) as i8;
        let y = ((code >> 6) & 7) as i8;
        let cells = place_bits(piece, orientation, x, y);
        let raw_board = board | cells;
        let next = normalize_after_placement(raw_board, 4);
        if next != full_board(4) {
            return Some(None);
        }
        Some(Some(Placement {
            piece,
            orientation,
            x,
            y,
            board: next,
            raw_board,
            cells,
        }))
    }
    #[inline]
    fn stage8_pair_mask(&self, board: u64, first: Piece) -> Option<u8> {
        if self.stage8_pair_masks.is_empty() {
            return None;
        }
        let index = self.stages[8].find(board)?;
        Some(self.stage8_pair_masks[index * 7 + first as usize])
    }
    #[inline]
    pub fn version(&self) -> u8 {
        self.version
    }
    #[inline]
    pub fn stage8_oracle_entries(&self) -> usize {
        self.stage8_pair_masks.len()
    }
    #[inline]
    pub fn stage9_oracle_entries(&self) -> usize {
        self.stage9_finish.len()
    }
    pub fn memory_bytes(&self) -> usize {
        self.stages
            .iter()
            .map(LegalStage::memory_bytes)
            .sum::<usize>()
            + self.stage8_pair_masks.capacity()
            + self.stage9_finish.capacity() * size_of::<u16>()
    }
}

const MAX_PLACEMENT_CACHE_ENTRIES: usize = 32_768;

pub struct PcSolver {
    height: u8,
    prune: bool,
    legal: Option<LegalTables>,
    // Keep the exact 40-bit fast-path key used by the 2..=4-line solver.
    placement_cache: FastMap<u64, PlacementSet>,
    // 5..=6-line compatibility boards can occupy bits 40..59, so they need
    // an explicit piece field instead of packing the piece above bit 40.
    compat_placement_cache: FastMap<CompatPlacementCacheKey, PlacementSet>,
    pub nodes: u64,
    pub memo_hits: u64,
    pub placement_cache_hits: u64,
    pub placement_cache_misses: u64,
    pub legal_rejects: u64,
}
impl PcSolver {
    pub fn new(height: u8) -> Self {
        assert!((2..=6).contains(&height));
        Self {
            height,
            prune: true,
            legal: None,
            placement_cache: FastMap::default(),
            compat_placement_cache: FastMap::default(),
            nodes: 0,
            memo_hits: 0,
            placement_cache_hits: 0,
            placement_cache_misses: 0,
            legal_rejects: 0,
        }
    }
    pub fn set_prune(&mut self, v: bool) {
        if self.prune != v {
            self.prune = v;
            self.placement_cache.clear();
            self.compat_placement_cache.clear();
        }
    }
    pub fn load_legal_pack(&mut self, bytes: &[u8]) -> bool {
        match LegalTables::from_pack(bytes) {
            Some(t) => {
                self.legal = Some(t);
                self.placement_cache.clear();
                self.compat_placement_cache.clear();
                true
            }
            None => false,
        }
    }
    #[inline]
    fn legal_accept(&mut self, b: u64) -> bool {
        let ok = self
            .legal
            .as_ref()
            .is_none_or(|t| t.accepts(b, self.height));
        if !ok {
            self.legal_rejects += 1
        }
        ok
    }
    pub fn legal_count(&self, stage: usize) -> usize {
        self.legal.as_ref().map_or(0, |t| t.count(stage))
    }
    pub fn legal_pack_version(&self) -> u8 {
        self.legal.as_ref().map_or(0, LegalTables::version)
    }
    pub fn legal_memory_bytes(&self) -> usize {
        self.legal.as_ref().map_or(0, LegalTables::memory_bytes)
    }
    pub fn stage8_oracle_entries(&self) -> usize {
        self.legal
            .as_ref()
            .map_or(0, LegalTables::stage8_oracle_entries)
    }
    pub fn stage9_oracle_entries(&self) -> usize {
        self.legal
            .as_ref()
            .map_or(0, LegalTables::stage9_oracle_entries)
    }
    pub fn placement_cache_entries(&self) -> usize {
        self.placement_cache.len() + self.compat_placement_cache.len()
    }

    pub fn reset_stats(&mut self) {
        self.nodes = 0;
        self.memo_hits = 0;
        self.placement_cache_hits = 0;
        self.placement_cache_misses = 0;
        self.legal_rejects = 0
    }
    #[inline]
    fn cache_key(board: u64, p: Piece) -> u64 {
        board | ((p as u64) << 40)
    }
    fn placement_set(&mut self, board: u64, p: Piece) -> PlacementSet {
        if self.height <= 4 {
            let k = Self::cache_key(board, p);
            if let Some(v) = self.placement_cache.get(&k) {
                self.placement_cache_hits += 1;
                return v.clone();
            }
        } else {
            let k = CompatPlacementCacheKey { board, piece: p };
            if let Some(v) = self.compat_placement_cache.get(&k) {
                self.placement_cache_hits += 1;
                return v.clone();
            }
        }
        self.placement_cache_misses += 1;
        let mut ps = reachable_placements(board, p, self.height);
        // These two topology prunes are deliberately kept on the established
        // four-line fast path only. Compatibility mode uses generic search.
        if self.prune && self.height == 4 {
            ps.retain(|x| !has_isolated_cell(x.board) && !has_imbalanced_split(x.board))
        }
        if self.legal.is_some() {
            ps.retain(|x| self.legal_accept(x.board));
        }
        let mut seen = FastSet::default();
        let next: Vec<u64> = ps
            .iter()
            .filter_map(|x| {
                if seen.insert(x.board) {
                    Some(x.board)
                } else {
                    None
                }
            })
            .collect();
        let set = PlacementSet {
            placements: Rc::from(ps),
            next: Rc::from(next),
        };
        if self.height <= 4 {
            self.placement_cache
                .insert(Self::cache_key(board, p), set.clone());
        } else {
            self.compat_placement_cache
                .insert(CompatPlacementCacheKey { board, piece: p }, set.clone());
        }
        set
    }
    // Generic 5..=6-line final-piece fast path. Reuse the same forward
    // frontier reachability as reachable_placements(), but search only for the
    // unique four-cell PC target and stop at the first matching lock.
    fn generic_finish_placement(&self, board: u64, p: Piece) -> Option<Placement> {
        let target = board_mask(self.height) & !board;
        if target.count_ones() != 4 {
            return None;
        }
        let (valid, inside) = valid_anchor_masks(board, p, self.height);
        if (0..4).all(|o| valid[o] & inside[o] == 0) {
            return None;
        }
        let mut reach = [0u128; 4];
        let spawn_rows = (0xffffu128 << (self.height as u32 * 16))
            | (0xffffu128 << ((self.height as u32 + 1) * 16));
        for o in 0..4 {
            reach[o] = valid[o] & spawn_rows;
        }
        let mut frontier = reach;
        while frontier.iter().any(|&x| x != 0) {
            let mut next = [0u128; 4];
            for o in 0..4 {
                next[o] |= ((frontier[o] << 1) | (frontier[o] >> 1) | (frontier[o] >> 16))
                    & valid[o]
                    & !reach[o];
            }
            let rotated = add_rotation_frontier(p, &frontier, &reach, &valid, Physics::Jstris);
            for o in 0..4 {
                next[o] |= rotated[o] & !reach[o];
                reach[o] |= next[o];
            }
            frontier = next;
        }
        for o in 0..4usize {
            let downable = valid[o] << 16;
            let mut locks = reach[o] & inside[o] & !downable;
            while locks != 0 {
                let bit = locks.trailing_zeros();
                locks &= locks - 1;
                let y = (bit / 16) as i8;
                let x = (bit % 16) as i8;
                let cells = place_bits(p, o as u8, x, y);
                if cells != target {
                    continue;
                }
                let raw_board = board | cells;
                return Some(Placement {
                    piece: p,
                    orientation: o as u8,
                    x,
                    y,
                    board: normalize_after_placement(raw_board, self.height),
                    raw_board,
                    cells,
                });
            }
        }
        None
    }

    // When exactly one tetromino remains, LGB2 contains the exact finishing
    // lock state.  Enumeration therefore keeps the same final geometry while
    // avoiding a full movement search.  LGB1 transparently falls back to the
    // normal placement cache.
    fn placement_set_for_remaining(&mut self, board: u64, p: Piece, remaining: u8) -> PlacementSet {
        if remaining == 1 {
            if let Some(result) = self
                .legal
                .as_ref()
                .and_then(|t| t.stage9_finish_placement(board, p))
            {
                return match result {
                    Some(pl) => PlacementSet {
                        placements: Rc::from(vec![pl]),
                        next: Rc::from(vec![pl.board]),
                    },
                    None => PlacementSet {
                        placements: Rc::from(Vec::<Placement>::new()),
                        next: Rc::from(Vec::<u64>::new()),
                    },
                };
            }
            if self.height > 4 {
                return match self.generic_finish_placement(board, p) {
                    Some(pl) => PlacementSet {
                        placements: Rc::from(vec![pl]),
                        next: Rc::from(vec![pl.board]),
                    },
                    None => PlacementSet {
                        placements: Rc::from(Vec::<Placement>::new()),
                        next: Rc::from(Vec::<u64>::new()),
                    },
                };
            }
        }
        self.placement_set(board, p)
    }

    #[inline]
    fn packed_piece(qbits: u64, index: u8) -> Option<Piece> {
        Piece::from_u8(((qbits >> (index as u32 * 3)) & 7) as u8)
    }

    #[inline]
    fn next_piece_mask(q: &[Piece], idx: u8, hold: u8, use_hold: bool) -> u8 {
        let n = q.len() as u8;
        let mut mask = 0u8;
        if idx < n {
            let cur = q[idx as usize];
            mask |= 1 << cur as u8;
            if use_hold {
                if hold == 7 {
                    if idx + 1 < n {
                        mask |= 1 << q[idx as usize + 1] as u8;
                    }
                } else {
                    mask |= 1 << hold;
                }
            }
        } else if use_hold && hold != 7 {
            mask |= 1 << hold;
        }
        mask
    }

    #[inline]
    fn next_piece_mask_packed(qbits: u64, qlen: u8, hold: u8, use_hold: bool) -> u8 {
        let mut mask = 0u8;
        if qlen > 0 {
            let cur = Self::packed_piece(qbits, 0).unwrap();
            mask |= 1 << cur as u8;
            if use_hold {
                if hold == 7 {
                    if qlen > 1 {
                        mask |= 1 << Self::packed_piece(qbits, 1).unwrap() as u8;
                    }
                } else {
                    mask |= 1 << hold;
                }
            }
        } else if use_hold && hold != 7 {
            mask |= 1 << hold;
        }
        mask
    }

    // Stage 8 has two tetrominoes left.  The oracle says which second piece
    // can follow a chosen first piece.  It is only a rejection test: when the
    // masks intersect we still enumerate exact first placements, preserving
    // all solution geometries.
    #[inline]
    fn stage8_pair_allows(
        &self,
        board: u64,
        first: Piece,
        next_piece_mask: u8,
        remaining: u8,
    ) -> bool {
        if remaining != 2 {
            return true;
        }
        let Some(pair_mask) = self
            .legal
            .as_ref()
            .and_then(|t| t.stage8_pair_mask(board, first))
        else {
            return true;
        };
        pair_mask & next_piece_mask != 0
    }
    #[inline]
    fn trim_cache_between_requests(&mut self) {
        if self.height <= 4 {
            if self.placement_cache.len() > MAX_PLACEMENT_CACHE_ENTRIES {
                self.placement_cache = FastMap::default();
            }
        } else if self.compat_placement_cache.len() > MAX_PLACEMENT_CACHE_ENTRIES {
            self.compat_placement_cache = FastMap::default();
        }
    }

    pub fn can_pc(&mut self, board: u64, queue: &[Piece], use_hold: bool) -> bool {
        let mut qbits = 0u64;
        for (i, &piece) in queue.iter().enumerate() {
            qbits |= (piece as u64) << (i * 3);
        }
        self.can_pc_packed(board, qbits, queue.len() as u8, use_hold)
    }

    pub fn can_pc_packed(&mut self, board: u64, qbits: u64, qlen: u8, use_hold: bool) -> bool {
        self.trim_cache_between_requests();
        if self.height <= 4 {
            let mut dead: FastSet<u64> = FastSet::default();
            self.can_pc_packed_with_dead::<FastCompletionKey>(
                board, qbits, qlen, use_hold, &mut dead,
            )
        } else {
            let mut dead: FastSet<u128> = FastSet::default();
            self.can_pc_packed_with_dead::<CompatCompletionKey>(
                board, qbits, qlen, use_hold, &mut dead,
            )
        }
    }

    pub fn can_pc_many_packed(
        &mut self,
        board: u64,
        qbits: &[u64],
        qlens: &[u8],
        use_hold: bool,
        out: &mut [u8],
    ) -> bool {
        if qbits.len() != qlens.len() || qbits.len() != out.len() || qlens.iter().any(|&n| n > 21) {
            return false;
        }
        // Keep the established 2..=4-line batch path unchanged: a compact
        // u64 dead-state memo is reused across queues but cleared per root.
        if self.height <= 4 {
            let mut dead: FastSet<u64> = FastSet::default();
            for i in 0..qbits.len() {
                self.trim_cache_between_requests();
                dead.clear();
                out[i] = self.can_pc_packed_with_dead::<FastCompletionKey>(
                    board, qbits[i], qlens[i], use_hold, &mut dead,
                ) as u8;
            }
        } else {
            // Compatibility mode needs 60 board bits, so its memo key uses
            // u128. Allocation is still reused across the batch and bounded
            // by the hardest single concrete queue.
            let mut dead: FastSet<u128> = FastSet::default();
            for i in 0..qbits.len() {
                self.trim_cache_between_requests();
                dead.clear();
                out[i] = self.can_pc_packed_with_dead::<CompatCompletionKey>(
                    board, qbits[i], qlens[i], use_hold, &mut dead,
                ) as u8;
            }
        }
        true
    }

    fn can_pc_packed_with_dead<K: CompletionKey>(
        &mut self,
        board: u64,
        qbits: u64,
        qlen: u8,
        use_hold: bool,
        dead: &mut FastSet<K::Key>,
    ) -> bool {
        if qlen > 21 {
            return false;
        }
        let total = self.height as u32 * 10;
        let empty = total.saturating_sub(board.count_ones());
        if !empty.is_multiple_of(4) {
            return false;
        }
        let req = (empty / 4) as u8;
        if qlen < req || !self.legal_accept(board) {
            return false;
        }
        self.dfs_packed::<K>(board, qbits, qlen, 7, req, use_hold, dead)
    }

    #[allow(clippy::too_many_arguments)]
    fn dfs_packed<K: CompletionKey>(
        &mut self,
        b: u64,
        qbits: u64,
        qlen: u8,
        hold: u8,
        remaining: u8,
        use_hold: bool,
        dead: &mut FastSet<K::Key>,
    ) -> bool {
        self.nodes += 1;
        if b == full_board(self.height) {
            return true;
        }
        if remaining == 0 || (self.height as u32 * 10 - b.count_ones()) != remaining as u32 * 4 {
            return false;
        }
        let key = K::make(b, qlen, hold);
        if dead.contains(&key) {
            self.memo_hits += 1;
            return false;
        }
        if qlen > 0 {
            let cur = Self::packed_piece(qbits, 0).unwrap();
            let after_cur_bits = qbits >> 3;
            let after_cur_len = qlen - 1;
            if self.stage8_pair_allows(
                b,
                cur,
                Self::next_piece_mask_packed(after_cur_bits, after_cur_len, hold, use_hold),
                remaining,
            ) {
                let set = self.placement_set_for_remaining(b, cur, remaining);
                for &nb in set.next.iter() {
                    if self.dfs_packed::<K>(
                        nb,
                        after_cur_bits,
                        after_cur_len,
                        hold,
                        remaining - 1,
                        use_hold,
                        dead,
                    ) {
                        return true;
                    }
                }
            }
            if use_hold {
                if hold == 7 {
                    if qlen > 1 {
                        let nxt = Self::packed_piece(qbits, 1).unwrap();
                        let after_two_bits = qbits >> 6;
                        let after_two_len = qlen - 2;
                        if self.stage8_pair_allows(
                            b,
                            nxt,
                            Self::next_piece_mask_packed(
                                after_two_bits,
                                after_two_len,
                                cur as u8,
                                use_hold,
                            ),
                            remaining,
                        ) {
                            let set = self.placement_set_for_remaining(b, nxt, remaining);
                            for &nb in set.next.iter() {
                                if self.dfs_packed::<K>(
                                    nb,
                                    after_two_bits,
                                    after_two_len,
                                    cur as u8,
                                    remaining - 1,
                                    use_hold,
                                    dead,
                                ) {
                                    return true;
                                }
                            }
                        }
                    }
                } else {
                    let hp = Piece::from_u8(hold).unwrap();
                    if self.stage8_pair_allows(
                        b,
                        hp,
                        Self::next_piece_mask_packed(
                            after_cur_bits,
                            after_cur_len,
                            cur as u8,
                            use_hold,
                        ),
                        remaining,
                    ) {
                        let set = self.placement_set_for_remaining(b, hp, remaining);
                        for &nb in set.next.iter() {
                            if self.dfs_packed::<K>(
                                nb,
                                after_cur_bits,
                                after_cur_len,
                                cur as u8,
                                remaining - 1,
                                use_hold,
                                dead,
                            ) {
                                return true;
                            }
                        }
                    }
                }
            }
        } else if use_hold && hold != 7 {
            let hp = Piece::from_u8(hold).unwrap();
            if self.stage8_pair_allows(b, hp, 0, remaining) {
                let set = self.placement_set_for_remaining(b, hp, remaining);
                for &nb in set.next.iter() {
                    if self.dfs_packed::<K>(nb, 0, 0, 7, remaining - 1, use_hold, dead) {
                        return true;
                    }
                }
            }
        }
        dead.insert(key);
        false
    }
    #[inline]
    fn multiset_count(packed: u32, piece: Piece) -> u8 {
        ((packed >> (piece as u32 * 4)) & 0x0f) as u8
    }

    #[inline]
    fn multiset_dec(packed: u32, piece: Piece) -> u32 {
        packed - (1u32 << (piece as u32 * 4))
    }

    #[inline]
    fn multiset_total(mut packed: u32) -> u8 {
        let mut total = 0u8;
        for _ in 0..7 {
            total += (packed & 0x0f) as u8;
            packed >>= 4;
        }
        total
    }

    fn packed_prefix_counts(qbits: u64, take: u8) -> Option<u32> {
        let mut counts = 0u32;
        for index in 0..take {
            let piece = Self::packed_piece(qbits, index)?;
            let shift = piece as u32 * 4;
            let count = ((counts >> shift) & 0x0f) + 1;
            if count > 15 {
                return None;
            }
            counts = (counts & !(0x0f << shift)) | (count << shift);
        }
        Some(counts)
    }

    // After `req` placements, a normal one-slot Hold queue has consumed either
    // req queue items (empty Hold) or req+1 queue items (one item left in Hold).
    // These count roots are therefore a small exact superset of all piece
    // multisets that can participate in a PC. Queue-order validation below
    // removes roots/orders that cannot actually be produced by a concrete case.
    fn pattern_multiset_roots(
        qbits: &[u64],
        qlens: &[u8],
        req: u8,
        use_hold: bool,
    ) -> FastSet<u32> {
        let mut roots = FastSet::default();
        for (&bits, &len) in qbits.iter().zip(qlens) {
            if len < req {
                continue;
            }
            if let Some(counts) = Self::packed_prefix_counts(bits, req) {
                roots.insert(counts);
            }
            if use_hold
                && len > req
                && let Some(counts) = Self::packed_prefix_counts(bits, req + 1)
            {
                for piece in Piece::ALL {
                    if Self::multiset_count(counts, piece) > 0 {
                        roots.insert(Self::multiset_dec(counts, piece));
                    }
                }
            }
        }
        roots
    }

    fn ensure_multiset_state(
        st: MultisetState,
        state_ids: &mut FastMap<MultisetState, u32>,
        states: &mut Vec<MultisetState>,
        nodes: &mut Vec<FlatDagNode>,
    ) -> u32 {
        if let Some(&id) = state_ids.get(&st) {
            return id;
        }
        let id = states.len() as u32;
        state_ids.insert(st, id);
        states.push(st);
        nodes.push(FlatDagNode::default());
        id
    }

    fn build_multiset_dag(
        &mut self,
        start_board: u64,
        roots: &FastSet<u32>,
    ) -> (FlatDag, Vec<u32>) {
        let mut state_ids = FastMap::default();
        let mut states = Vec::new();
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        let mut root_ids = Vec::with_capacity(roots.len());
        for &remaining_counts in roots {
            root_ids.push(Self::ensure_multiset_state(
                MultisetState {
                    board: start_board,
                    remaining_counts,
                },
                &mut state_ids,
                &mut states,
                &mut nodes,
            ));
        }

        // Iterative construction keeps every node's outgoing edges contiguous
        // in one arena. Child states are queued instead of being recursively
        // built between parent edges.
        let mut cursor = 0usize;
        while cursor < states.len() {
            let st = states[cursor];
            self.nodes += 1;
            let remaining = Self::multiset_total(st.remaining_counts);
            let edge_start = edges.len();
            for piece in Piece::ALL {
                if Self::multiset_count(st.remaining_counts, piece) == 0 {
                    continue;
                }
                let next_counts = Self::multiset_dec(st.remaining_counts, piece);
                let set = self.placement_set_for_remaining(st.board, piece, remaining);
                // reachable_placements already deduplicates lock operations
                // for a piece on this board, so a second per-node hash set is
                // redundant here.
                for &pl in set.placements.iter() {
                    if pl.board == full_board(self.height) {
                        if remaining == 1 {
                            edges.push(DagEdge {
                                raw_board: pl.raw_board,
                                next: TERMINAL_NODE,
                                piece,
                                orientation: pl.orientation,
                                x: pl.x,
                                y: pl.y,
                                saved: 7,
                            });
                        }
                        continue;
                    }
                    if remaining <= 1 {
                        continue;
                    }
                    let remaining_cells = self.height as u32 * 10 - pl.board.count_ones();
                    if remaining_cells != (remaining - 1) as u32 * 4 {
                        continue;
                    }
                    if self.height > 4 && column_run_reject(pl.board, self.height) {
                        continue;
                    }
                    let child = Self::ensure_multiset_state(
                        MultisetState {
                            board: pl.board,
                            remaining_counts: next_counts,
                        },
                        &mut state_ids,
                        &mut states,
                        &mut nodes,
                    );
                    edges.push(DagEdge {
                        raw_board: pl.raw_board,
                        next: child,
                        piece,
                        orientation: pl.orientation,
                        x: pl.x,
                        y: pl.y,
                        saved: 7,
                    });
                }
            }
            nodes[cursor] = FlatDagNode {
                edge_start: edge_start as u32,
                edge_len: (edges.len() - edge_start) as u32,
            };
            cursor += 1;
        }

        let mut dag = FlatDag {
            productive: vec![0u8; nodes.len()],
            nodes,
            edges,
        };
        for &root in &root_ids {
            Self::flat_dag_productive(&mut dag, root);
        }
        root_ids.retain(|&root| dag.productive[root as usize] == 2);
        (dag, root_ids)
    }

    fn flat_dag_productive(dag: &mut FlatDag, node: u32) -> bool {
        match dag.productive[node as usize] {
            1 => return false,
            2 => return true,
            _ => {}
        }
        // Remaining piece counts strictly decrease across every non-terminal
        // edge, so this recursion cannot cycle.
        let meta = dag.nodes[node as usize];
        let start = meta.edge_start as usize;
        let end = start + meta.edge_len as usize;
        let mut productive = false;
        for index in start..end {
            let next = dag.edges[index].next;
            let edge_productive = next == TERMINAL_NODE || Self::flat_dag_productive(dag, next);
            productive |= edge_productive;
        }
        dag.productive[node as usize] = if productive { 2 } else { 1 };
        productive
    }

    fn collect_flat_dag_paths(
        height: u8,
        dag: &FlatDag,
        node: u32,
        path: DagPathState,
        out: &mut FastMap<CompactSolution, FastSet<u64>>,
    ) {
        for edge in dag.edges(node) {
            if edge.next != TERMINAL_NODE && dag.productive[edge.next as usize] != 2 {
                continue;
            }
            let Some((next_cleared, original_mask)) = map_placement_to_original(
                height,
                path.cleared_rows,
                edge.piece,
                edge.orientation,
                edge.x,
                edge.y,
                edge.raw_board,
            ) else {
                continue;
            };
            let next_compact = path.compact.with_piece_mask(edge.piece, original_mask);
            let next_order = path.order_bits | ((edge.piece as u64 + 1) << (path.depth as u32 * 3));
            if edge.next == TERMINAL_NODE {
                out.entry(next_compact).or_default().insert(next_order);
            } else {
                Self::collect_flat_dag_paths(
                    height,
                    dag,
                    edge.next,
                    DagPathState {
                        depth: path.depth + 1,
                        cleared_rows: next_cleared,
                        compact: next_compact,
                        order_bits: next_order,
                    },
                    out,
                );
            }
        }
    }

    fn collect_flat_dag_orders(
        dag: &FlatDag,
        node: u32,
        depth: u8,
        order_bits: u64,
        out: &mut FastSet<u64>,
    ) {
        for edge in dag.edges(node) {
            if edge.next != TERMINAL_NODE && dag.productive[edge.next as usize] != 2 {
                continue;
            }
            let next_order = order_bits | ((edge.piece as u64 + 1) << (depth as u32 * 3));
            if edge.next == TERMINAL_NODE {
                out.insert(next_order);
            } else {
                Self::collect_flat_dag_orders(dag, edge.next, depth + 1, next_order, out);
            }
        }
    }

    // Existence-only pattern batch for 5..=6-line compatibility mode. It
    // shares the same multiset geometry DAG and queue-trie Hold projection as
    // full pattern enumeration, but skips solution-colour reconstruction.
    // This is the hot path for chance/solve-rate queries.
    pub fn can_pc_pattern_many_packed(
        &mut self,
        initial: u64,
        qbits: &[u64],
        qlens: &[u8],
        use_hold: bool,
        out: &mut [u8],
    ) -> bool {
        if qbits.len() != qlens.len()
            || qbits.len() != out.len()
            || qlens.iter().any(|&len| len > 21)
        {
            return false;
        }
        if self.height <= 4 {
            return self.can_pc_many_packed(initial, qbits, qlens, use_hold, out);
        }
        out.fill(0);
        self.trim_cache_between_requests();
        let total = self.height as u32 * 10;
        let empty = total.saturating_sub(initial.count_ones());
        if !empty.is_multiple_of(4) || !self.legal_accept(initial) {
            return true;
        }
        let req = (empty / 4) as u8;
        if req == 0 {
            if initial == full_board(self.height) {
                out.fill(1);
            }
            return true;
        }
        let roots = Self::pattern_multiset_roots(qbits, qlens, req, use_hold);
        if roots.is_empty() {
            return true;
        }
        let start_board = normalize_after_placement(initial, self.height);
        let (dag, root_ids) = self.build_multiset_dag(start_board, &roots);
        if root_ids.is_empty() {
            return true;
        }

        let mut orders = FastSet::default();
        for root in root_ids {
            Self::collect_flat_dag_orders(&dag, root, 0, 0, &mut orders);
        }
        if orders.is_empty() {
            return true;
        }

        let Some(queue_trie) = QueueTrie::new(qbits, qlens) else {
            return false;
        };
        let mut scratch = QueueTrieScratch::new(queue_trie.nodes.len());
        let mut covered = vec![0u64; queue_trie.words];
        let mut covered_count = 0usize;
        for order in orders {
            let bits = queue_trie.coverage_for_order(order, req, use_hold, &mut scratch);
            for (dst, src) in covered.iter_mut().zip(bits) {
                let new_bits = src & !*dst;
                covered_count += new_bits.count_ones() as usize;
                *dst |= src;
            }
            if covered_count >= out.len() {
                break;
            }
        }
        for (word_index, word) in covered.into_iter().enumerate() {
            let mut bits = word;
            while bits != 0 {
                let bit = bits.trailing_zeros() as usize;
                bits &= bits - 1;
                let dfs_idx = word_index * 64 + bit;
                if dfs_idx < queue_trie.perm.len() {
                    let case = queue_trie.perm[dfs_idx] as usize;
                    if case < out.len() {
                        out[case] = 1;
                    }
                }
            }
        }
        true
    }

    // Pattern-level compatibility enumeration for broad 4..=6-line queue sets. Geometry is
    // explored once per relevant piece multiset; concrete queues are applied
    // afterwards to the resulting piece orders. This removes the dominant
    // `N queues × enumerate_pc` repetition of the legacy compatibility path.
    pub fn enumerate_pc_pattern_packed(
        &mut self,
        initial: u64,
        qbits: &[u64],
        qlens: &[u8],
        use_hold: bool,
    ) -> Option<Vec<PatternSolutionCoverage>> {
        if qbits.len() != qlens.len() || qlens.iter().any(|&len| len > 21) {
            return None;
        }
        self.trim_cache_between_requests();
        let total = self.height as u32 * 10;
        let empty = total.saturating_sub(initial.count_ones());
        if !empty.is_multiple_of(4) || !self.legal_accept(initial) {
            return Some(Vec::new());
        }
        let req = (empty / 4) as u8;
        if req == 0 {
            return Some(Vec::new());
        }
        let roots = Self::pattern_multiset_roots(qbits, qlens, req, use_hold);
        if roots.is_empty() {
            return Some(Vec::new());
        }

        let mut initial_cleared = 0u8;
        for y in 0..self.height {
            if row(initial, y) == FULL_ROW {
                initial_cleared |= 1 << y;
            }
        }
        let start_board = normalize_after_placement(initial, self.height);
        let (dag, root_ids) = self.build_multiset_dag(start_board, &roots);

        let mut compact = FastMap::default();
        for root in root_ids {
            Self::collect_flat_dag_paths(
                self.height,
                &dag,
                root,
                DagPathState {
                    depth: 0,
                    cleared_rows: initial_cleared,
                    compact: CompactSolution::default(),
                    order_bits: 0,
                },
                &mut compact,
            );
        }
        if compact.is_empty() {
            return Some(Vec::new());
        }

        let queue_trie = QueueTrie::new(qbits, qlens)?;
        let mut queue_scratch = QueueTrieScratch::new(queue_trie.nodes.len());
        let mut order_coverage: FastMap<u64, Vec<u64>> = FastMap::default();
        for orders in compact.values() {
            for &order in orders {
                order_coverage.entry(order).or_insert_with(|| {
                    queue_trie.coverage_for_order(order, req, use_hold, &mut queue_scratch)
                });
            }
        }

        let mut case_order_counts = vec![0u32; qbits.len()];
        let mut touched = Vec::new();
        let mut out = Vec::new();
        for (solution, orders) in compact {
            touched.clear();
            for order in &orders {
                let covered = &order_coverage[order];
                for (word_index, &word) in covered.iter().enumerate() {
                    let mut bits = word;
                    while bits != 0 {
                        let bit = bits.trailing_zeros() as usize;
                        bits &= bits - 1;
                        let dfs_idx = word_index * 64 + bit;
                        if dfs_idx >= queue_trie.perm.len() {
                            continue;
                        }
                        let case = queue_trie.perm[dfs_idx] as usize;
                        if case >= qbits.len() {
                            continue;
                        }
                        if case_order_counts[case] == 0 {
                            touched.push(case as u32);
                        }
                        case_order_counts[case] = case_order_counts[case].saturating_add(1);
                    }
                }
            }
            if touched.is_empty() {
                continue;
            }
            touched.sort_unstable();
            debug_assert!(
                touched
                    .iter()
                    .all(|&case| case_order_counts[case as usize] >= 1)
            );
            let cases = touched
                .iter()
                .map(|&case| (case, case_order_counts[case as usize]))
                .collect();
            for &case in &touched {
                case_order_counts[case as usize] = 0;
            }
            out.push(PatternSolutionCoverage {
                solution: Solution {
                    masks: solution.masks(self.height),
                    order_count: orders.len().min(u32::MAX as usize) as u32,
                },
                cases,
            });
        }
        out.sort_by_key(|entry| entry.solution.masks);
        Some(out)
    }

    #[inline]
    fn terminal_saved_piece(queue: &[Piece], next_idx: u8, next_hold: u8) -> u8 {
        let mut saved = 7u8;
        let mut remaining = 0u8;
        if next_hold != 7 {
            saved = next_hold;
            remaining += 1;
        }
        for &piece in &queue[next_idx as usize..] {
            saved = piece as u8;
            remaining += 1;
            if remaining > 1 {
                return 7;
            }
        }
        if remaining == 1 { saved } else { 7 }
    }

    fn ensure_structural_state(
        st: StructuralState,
        state_ids: &mut FastMap<StructuralState, u32>,
        states: &mut Vec<StructuralState>,
        nodes: &mut Vec<FlatDagNode>,
    ) -> u32 {
        if let Some(&id) = state_ids.get(&st) {
            return id;
        }
        let id = states.len() as u32;
        state_ids.insert(st, id);
        states.push(st);
        nodes.push(FlatDagNode::default());
        id
    }

    #[allow(clippy::too_many_arguments)]
    fn push_structural_transition(
        &mut self,
        st: StructuralState,
        piece: Piece,
        next_idx: u8,
        next_hold: u8,
        pl: Placement,
        queue: &[Piece],
        req: u8,
        state_ids: &mut FastMap<StructuralState, u32>,
        states: &mut Vec<StructuralState>,
        nodes: &mut Vec<FlatDagNode>,
        edges: &mut Vec<DagEdge>,
    ) {
        let next_placed = st.placed + 1;
        if pl.board == full_board(self.height) {
            if next_placed == req {
                edges.push(DagEdge {
                    raw_board: pl.raw_board,
                    next: TERMINAL_NODE,
                    piece,
                    orientation: pl.orientation,
                    x: pl.x,
                    y: pl.y,
                    saved: Self::terminal_saved_piece(queue, next_idx, next_hold),
                });
            }
            return;
        }
        if next_placed >= req {
            return;
        }
        let remaining_cells = self.height as u32 * 10 - pl.board.count_ones();
        if remaining_cells != (req - next_placed) as u32 * 4 {
            return;
        }
        let child = Self::ensure_structural_state(
            StructuralState {
                board: pl.board,
                idx: next_idx,
                hold: next_hold,
                placed: next_placed,
            },
            state_ids,
            states,
            nodes,
        );
        edges.push(DagEdge {
            raw_board: pl.raw_board,
            next: child,
            piece,
            orientation: pl.orientation,
            x: pl.x,
            y: pl.y,
            saved: 7,
        });
    }

    // Concrete-queue search and pattern search use the same flat DAG storage.
    // Building iteratively keeps every node's outgoing edges contiguous and
    // avoids recursive child construction plus per-node Vec allocations.
    fn build_structural_dag(
        &mut self,
        initial: u64,
        queue: &[Piece],
        use_hold: bool,
    ) -> Option<(FlatDag, u32, u8, u8)> {
        self.trim_cache_between_requests();
        let total = self.height as u32 * 10;
        let empty = total.saturating_sub(initial.count_ones());
        if !empty.is_multiple_of(4) {
            return None;
        }
        let req = (empty / 4) as u8;
        if queue.len() < req as usize || !self.legal_accept(initial) {
            return None;
        }
        let mut initial_cleared = 0u8;
        for y in 0..self.height {
            if row(initial, y) == FULL_ROW {
                initial_cleared |= 1 << y;
            }
        }
        let start = StructuralState {
            board: normalize_after_placement(initial, self.height),
            idx: 0,
            hold: 7,
            placed: 0,
        };
        let mut state_ids = FastMap::default();
        let mut states = Vec::new();
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        let root = Self::ensure_structural_state(start, &mut state_ids, &mut states, &mut nodes);
        let n = queue.len() as u8;
        let mut cursor = 0usize;
        while cursor < states.len() {
            let st = states[cursor];
            self.nodes += 1;
            let remaining = req - st.placed;
            let edge_start = edges.len();
            if st.idx < n {
                let cur = queue[st.idx as usize];
                if self.stage8_pair_allows(
                    st.board,
                    cur,
                    Self::next_piece_mask(queue, st.idx + 1, st.hold, use_hold),
                    remaining,
                ) {
                    let set = self.placement_set_for_remaining(st.board, cur, remaining);
                    for &pl in set.placements.iter() {
                        self.push_structural_transition(
                            st,
                            cur,
                            st.idx + 1,
                            st.hold,
                            pl,
                            queue,
                            req,
                            &mut state_ids,
                            &mut states,
                            &mut nodes,
                            &mut edges,
                        );
                    }
                }
                if use_hold {
                    if st.hold == 7 {
                        if st.idx + 1 < n {
                            let next_piece = queue[st.idx as usize + 1];
                            if self.stage8_pair_allows(
                                st.board,
                                next_piece,
                                Self::next_piece_mask(queue, st.idx + 2, cur as u8, use_hold),
                                remaining,
                            ) {
                                let set = self
                                    .placement_set_for_remaining(st.board, next_piece, remaining);
                                for &pl in set.placements.iter() {
                                    self.push_structural_transition(
                                        st,
                                        next_piece,
                                        st.idx + 2,
                                        cur as u8,
                                        pl,
                                        queue,
                                        req,
                                        &mut state_ids,
                                        &mut states,
                                        &mut nodes,
                                        &mut edges,
                                    );
                                }
                            }
                        }
                    } else {
                        let held = Piece::from_u8(st.hold).unwrap();
                        // Swapping equal piece types is structurally identical
                        // to using the active piece directly, so skip the
                        // duplicate transition instead of hashing every edge.
                        if held != cur
                            && self.stage8_pair_allows(
                                st.board,
                                held,
                                Self::next_piece_mask(queue, st.idx + 1, cur as u8, use_hold),
                                remaining,
                            )
                        {
                            let set = self.placement_set_for_remaining(st.board, held, remaining);
                            for &pl in set.placements.iter() {
                                self.push_structural_transition(
                                    st,
                                    held,
                                    st.idx + 1,
                                    cur as u8,
                                    pl,
                                    queue,
                                    req,
                                    &mut state_ids,
                                    &mut states,
                                    &mut nodes,
                                    &mut edges,
                                );
                            }
                        }
                    }
                }
            } else if use_hold && st.hold != 7 {
                let held = Piece::from_u8(st.hold).unwrap();
                if self.stage8_pair_allows(st.board, held, 0, remaining) {
                    let set = self.placement_set_for_remaining(st.board, held, remaining);
                    for &pl in set.placements.iter() {
                        self.push_structural_transition(
                            st,
                            held,
                            st.idx,
                            7,
                            pl,
                            queue,
                            req,
                            &mut state_ids,
                            &mut states,
                            &mut nodes,
                            &mut edges,
                        );
                    }
                }
            }
            nodes[cursor] = FlatDagNode {
                edge_start: edge_start as u32,
                edge_len: (edges.len() - edge_start) as u32,
            };
            cursor += 1;
        }
        let mut dag = FlatDag {
            productive: vec![0u8; nodes.len()],
            nodes,
            edges,
        };
        if !Self::flat_dag_productive(&mut dag, root) {
            None
        } else {
            Some((dag, root, req, initial_cleared))
        }
    }

    fn enumerate_compact(
        &mut self,
        initial: u64,
        queue: &[Piece],
        use_hold: bool,
    ) -> FastMap<CompactSolution, FastSet<u64>> {
        let Some((dag, root, _req, initial_cleared)) =
            self.build_structural_dag(initial, queue, use_hold)
        else {
            return FastMap::default();
        };
        let mut solutions = FastMap::default();
        Self::collect_flat_dag_paths(
            self.height,
            &dag,
            root,
            DagPathState {
                depth: 0,
                cleared_rows: initial_cleared,
                compact: CompactSolution::default(),
                order_bits: 0,
            },
            &mut solutions,
        );
        solutions
    }

    pub fn enumerate_pc(&mut self, initial: u64, queue: &[Piece], use_hold: bool) -> Vec<Solution> {
        let compact = self.enumerate_compact(initial, queue, use_hold);
        let mut out: Vec<_> = compact
            .into_iter()
            .map(|(solution, orders)| {
                debug_assert!(!orders.is_empty());
                Solution {
                    masks: solution.masks(self.height),
                    order_count: orders.len().min(u32::MAX as usize) as u32,
                }
            })
            .collect();
        out.sort_by_key(|solution| solution.masks);
        out
    }

    // Exact single-queue preferred solution. This preserves the existing
    // qniapc ranking (highest playable-order count, then lexicographic Fumen
    // mask key) while keeping all filtering and reduction inside Rust.
    pub fn best_pc(&mut self, initial: u64, queue: &[Piece], use_hold: bool) -> Option<Solution> {
        let compact = self.enumerate_compact(initial, queue, use_hold);
        let mut best: Option<Solution> = None;
        for (solution, orders) in compact {
            debug_assert!(!orders.is_empty());
            let candidate = Solution {
                masks: solution.masks(self.height),
                order_count: orders.len().min(u32::MAX as usize) as u32,
            };
            let replace = match &best {
                None => true,
                Some(current) if candidate.order_count != current.order_count => {
                    candidate.order_count > current.order_count
                }
                Some(current) => Self::solution_key_cmp(&candidate.masks, &current.masks).is_lt(),
            };
            if replace {
                best = Some(candidate);
            }
        }
        best
    }

    fn write_solution_key(masks: &[u64; 7], output: &mut [u8; 118]) -> usize {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut cursor = 0usize;
        for (piece_index, &mask) in masks.iter().enumerate() {
            if piece_index != 0 {
                output[cursor] = b':';
                cursor += 1;
            }
            if mask == 0 {
                output[cursor] = b'0';
                cursor += 1;
                continue;
            }
            let leading_nibbles = mask.leading_zeros() as usize / 4;
            for nibble_index in leading_nibbles..16 {
                let shift = (15 - nibble_index) * 4;
                output[cursor] = HEX[((mask >> shift) & 0x0f) as usize];
                cursor += 1;
            }
        }
        cursor
    }

    fn solution_key_cmp(left: &[u64; 7], right: &[u64; 7]) -> std::cmp::Ordering {
        let mut left_key = [0u8; 118];
        let mut right_key = [0u8; 118];
        let left_len = Self::write_solution_key(left, &mut left_key);
        let right_len = Self::write_solution_key(right, &mut right_key);
        left_key[..left_len].cmp(&right_key[..right_len])
    }

    #[cfg(test)]
    fn solution_key(masks: &[u64; 7]) -> String {
        format!(
            "{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}",
            masks[0], masks[1], masks[2], masks[3], masks[4], masks[5], masks[6]
        )
    }

    pub fn saved_piece_for_solution(queue: &[Piece], solution: &Solution) -> u8 {
        let mut remaining = [0i16; 7];
        for &piece in queue {
            remaining[piece as usize] += 1;
        }
        for piece in Piece::ALL {
            let used = (solution.masks[piece as usize].count_ones() / 4) as i16;
            remaining[piece as usize] -= used;
            if remaining[piece as usize] < 0 {
                return 7;
            }
        }
        let mut saved = 7u8;
        let mut total = 0i16;
        for piece in Piece::ALL {
            let count = remaining[piece as usize];
            total += count;
            if count > 0 {
                if count != 1 || saved != 7 {
                    return 7;
                }
                saved = piece as u8;
            }
        }
        if total == 1 { saved } else { 7 }
    }

    // Return the save-piece set reachable from a DAG node.  Because every
    // edge advances `placed`, the graph is acyclic even when multiple paths
    // merge into the same structural state.
    #[allow(dead_code)]
    fn reachable_save_mask(dag: &FlatDag, node: u32, memo: &mut [u8]) -> u8 {
        let cached = memo[node as usize];
        if cached != u8::MAX {
            return cached;
        }
        let mut mask = 0u8;
        for edge in dag.edges(node) {
            if edge.next == TERMINAL_NODE {
                if edge.saved < 7 {
                    mask |= 1 << edge.saved;
                }
            } else {
                mask |= Self::reachable_save_mask(dag, edge.next, memo);
            }
        }
        memo[node as usize] = mask;
        mask
    }

    #[inline]
    #[allow(dead_code)]
    fn candidate_quota_full(mask: u8, limit: usize, out: &[Vec<CompactSolution>; 7]) -> bool {
        Piece::ALL
            .iter()
            .all(|&piece| mask & (1 << piece as u8) == 0 || out[piece as usize].len() >= limit)
    }

    // Traverse the successful DAG only once and retain at most `limit`
    // distinct geometries for every reachable save piece.  This replaces the
    // older per-save repeated traversal while preserving bounded Top-K work.
    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
    fn collect_save_candidates(
        height: u8,
        dag: &FlatDag,
        node: u32,
        cleared_rows: u8,
        compact: CompactSolution,
        reachable_mask: u8,
        limit: usize,
        seen: &mut [FastSet<CompactSolution>; 7],
        out: &mut [Vec<CompactSolution>; 7],
    ) -> bool {
        for edge in dag.edges(node) {
            let Some((next_cleared, original_mask)) = map_placement_to_original(
                height,
                cleared_rows,
                edge.piece,
                edge.orientation,
                edge.x,
                edge.y,
                edge.raw_board,
            ) else {
                continue;
            };
            let next_compact = compact.with_piece_mask(edge.piece, original_mask);
            if edge.next == TERMINAL_NODE {
                if edge.saved < 7 {
                    let index = edge.saved as usize;
                    if out[index].len() < limit && seen[index].insert(next_compact) {
                        out[index].push(next_compact);
                    }
                }
            } else if Self::collect_save_candidates(
                height,
                dag,
                edge.next,
                next_cleared,
                next_compact,
                reachable_mask,
                limit,
                seen,
                out,
            ) {
                return true;
            }
            if Self::candidate_quota_full(reachable_mask, limit, out) {
                return true;
            }
        }
        false
    }

    // Count the distinct piece-type placement orders that lead to one selected
    // geometry.  This second pass only follows edges whose cells belong to the
    // candidate, so it avoids materializing unrelated PC solutions.
    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
    fn collect_candidate_orders(
        height: u8,
        dag: &FlatDag,
        node: u32,
        depth: u8,
        cleared_rows: u8,
        compact: CompactSolution,
        target: CompactSolution,
        target_masks: &[u64; 7],
        order_bits: u64,
        orders: &mut FastSet<u64>,
    ) {
        for edge in dag.edges(node) {
            let Some((next_cleared, original_mask)) = map_placement_to_original(
                height,
                cleared_rows,
                edge.piece,
                edge.orientation,
                edge.x,
                edge.y,
                edge.raw_board,
            ) else {
                continue;
            };
            let allowed = target_masks[edge.piece as usize];
            if original_mask & !allowed != 0 {
                continue;
            }
            let next_compact = compact.with_piece_mask(edge.piece, original_mask);
            let next_order = order_bits | ((edge.piece as u64 + 1) << (depth as u32 * 3));
            if edge.next == TERMINAL_NODE {
                if next_compact == target {
                    orders.insert(next_order);
                }
            } else {
                Self::collect_candidate_orders(
                    height,
                    dag,
                    edge.next,
                    depth + 1,
                    next_cleared,
                    next_compact,
                    target,
                    target_masks,
                    next_order,
                    orders,
                );
            }
        }
    }

    pub fn per_save_best(
        &mut self,
        initial: u64,
        queue: &[Piece],
        use_hold: bool,
        _candidate_limit: usize,
    ) -> Vec<(Piece, Solution)> {
        let compact = self.enumerate_compact(initial, queue, use_hold);
        if compact.is_empty() {
            return Vec::new();
        }

        // Exact per-save ranking: maximize playable-order count for each saved
        // piece, then apply the same stable solution-key tie as full enumeration.
        // candidate_limit remains in the ABI for compatibility but no longer
        // bounds or approximates production results.
        let mut best: [Option<(CompactSolution, u32)>; 7] = [None; 7];
        for (solution, orders) in compact {
            debug_assert!(!orders.is_empty());
            let candidate = Solution {
                masks: solution.masks(self.height),
                order_count: orders.len().min(u32::MAX as usize) as u32,
            };
            let saved = Self::saved_piece_for_solution(queue, &candidate);
            if saved >= 7 {
                continue;
            }
            let slot = &mut best[saved as usize];
            let replace = match *slot {
                None => true,
                Some((_current, current_count)) if candidate.order_count != current_count => {
                    candidate.order_count > current_count
                }
                Some((current, _)) => {
                    let current_masks = current.masks(self.height);
                    Self::solution_key_cmp(&candidate.masks, &current_masks).is_lt()
                }
            };
            if replace {
                *slot = Some((solution, candidate.order_count));
            }
        }

        let mut out = Vec::new();
        for saved_piece in Piece::ALL {
            if let Some((solution, order_count)) = best[saved_piece as usize] {
                out.push((
                    saved_piece,
                    Solution {
                        masks: solution.masks(self.height),
                        order_count,
                    },
                ));
            }
        }
        out
    }
}

pub fn decode_queue_bits(bits: u64, len: u8) -> Option<Vec<Piece>> {
    if len > 21 {
        return None;
    }
    let mut out = Vec::with_capacity(len as usize);
    for i in 0..len {
        out.push(Piece::from_u8(((bits >> (i as u32 * 3)) & 7) as u8)?)
    }
    Some(out)
}
pub fn decode_queue_array(bits: u64, len: u8) -> Option<([Piece; 21], usize)> {
    if len > 21 {
        return None;
    }
    let mut out = [Piece::I; 21];
    for i in 0..len {
        out[i as usize] = Piece::from_u8(((bits >> (i as u32 * 3)) & 7) as u8)?;
    }
    Some((out, len as usize))
}
pub fn encode_queue_ascii(s: &str) -> Option<u64> {
    if s.len() > 21 {
        return None;
    }
    let mut bits = 0u64;
    for (i, c) in s.bytes().enumerate() {
        bits |= (Piece::from_char(c)? as u64) << (i * 3)
    }
    Some(bits)
}

// Reverse geometric predecessor candidates used by the offline legal-board tool.
pub fn geometric_predecessor_pairs(out: u64, height: u8) -> Vec<(u64, Piece)> {
    let cp = cleared_floor(out, height);
    let unresolved: Vec<u64> = (cp..height).map(|y| row(out, y)).collect();
    let mut preds: FastSet<(u64, u8)> = FastSet::default();
    for c in 0..=cp {
        let d = (cp - c) as usize;
        let slots = (height - c) as usize;
        if d > slots {
            continue;
        }
        for fullmask in 0..(1usize << slots) {
            if fullmask.count_ones() as usize != d {
                continue;
            }
            let mut raw = 0u64;
            for y in 0..c {
                raw |= FULL_ROW << (y as u32 * 10);
            }
            let mut ui = 0usize;
            for i in 0..slots {
                let y = c + i as u8;
                if (fullmask >> i) & 1 == 1 {
                    raw |= FULL_ROW << (y as u32 * 10);
                } else {
                    raw |= unresolved[ui] << (y as u32 * 10);
                    ui += 1;
                }
            }
            if normalize_after_placement(raw, height) != out {
                continue;
            }
            for piece in Piece::ALL {
                for o in 0..4u8 {
                    for y in c as i8..height as i8 {
                        if y + MAX_Y[piece as usize][o as usize] >= height as i8 {
                            continue;
                        }
                        for x in 0..=MAX_X[piece as usize][o as usize] {
                            let bits = place_bits(piece, o, x, y);
                            if bits & raw != bits {
                                continue;
                            }
                            if c > 0 && bits & ((1u64 << (c as u32 * 10)) - 1) != 0 {
                                continue;
                            }
                            let b = raw & !bits;
                            if normalize_after_placement(b, height) != b {
                                continue;
                            }
                            if b.count_ones() + 4 != out.count_ones() {
                                continue;
                            }
                            preds.insert((b, piece as u8));
                        }
                    }
                }
            }
        }
    }
    preds
        .into_iter()
        .filter_map(|(b, p)| Some((b, Piece::from_u8(p)?)))
        .collect()
}
pub fn geometric_predecessors(out: u64, height: u8) -> Vec<u64> {
    let mut s: FastSet<u64> = FastSet::default();
    for (b, _) in geometric_predecessor_pairs(out, height) {
        s.insert(b);
    }
    s.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sig(mut v: Vec<Placement>) -> Vec<(u64, u8, i8, i8)> {
        let mut x: Vec<_> = v
            .drain(..)
            .map(|p| {
                (
                    p.board,
                    match p.piece {
                        Piece::O => 0,
                        Piece::I | Piece::S | Piece::Z => p.orientation & 1,
                        _ => p.orientation,
                    },
                    p.x,
                    p.y,
                )
            })
            .collect();
        x.sort_unstable();
        x
    }
    #[test]
    fn normalize_lines() {
        let b = FULL_ROW | (1 << 10);
        assert_eq!(normalize_after_placement(b, 4), FULL_ROW | (1 << 10))
    }
    #[test]
    fn bitset_matches_bfs_empty() {
        for h in 2..=4 {
            for p in Piece::ALL {
                assert_eq!(
                    sig(reachable_placements(0, p, h)),
                    sig(reachable_placements_bfs(0, p, h)),
                    "h={h} p={p:?}"
                )
            }
        }
    }
    #[test]
    fn bitset_matches_bfs_sample_boards() {
        let boards = [
            0x0000000000,
            0x00000003ff,
            0x000003f0c3,
            0x0000f030c3,
            0x00c03030c3,
        ];
        for &b in &boards {
            for p in Piece::ALL {
                if b & !board_mask(4) == 0 {
                    assert_eq!(
                        sig(reachable_placements(b, p, 4)),
                        sig(reachable_placements_bfs(b, p, 4)),
                        "b={b:x} p={p:?}"
                    )
                }
            }
        }
    }
    #[test]
    fn bitset_matches_bfs_randomized_boards() {
        let mut x = 0x1234_5678_9abc_def0u64;
        for _ in 0..96 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let b = normalize_after_placement(x & board_mask(4), 4);
            for p in Piece::ALL {
                assert_eq!(
                    sig(reachable_placements(b, p, 4)),
                    sig(reachable_placements_bfs(b, p, 4)),
                    "b={b:x} p={p:?}"
                );
            }
        }
    }

    #[test]
    fn packed_boards_lookup() {
        let values = [0u64, 1, 0x12345, 0x0012_3456_789a, (1u64 << 40) - 1];
        let mut packed = PackedBoards {
            data: Vec::new(),
            len: 0,
        };
        for &value in &values {
            packed.push(value);
        }
        packed.finish();
        for (i, &value) in values.iter().enumerate() {
            assert_eq!(packed.get(i), value);
            assert_eq!(packed.find(value), Some(i));
        }
        assert_eq!(packed.find(0x4242), None);
    }

    #[test]
    fn simple_two_line() {
        let mut s = PcSolver::new(2);
        assert!(s.can_pc(0, &[Piece::O; 5], true))
    }
    #[test]
    fn cover_exact_reachability_preserves_one_side_i_tuck() {
        let s_mask = 0x3006u64;
        let i_mask = 0x78u64;
        let z_mask = 0x30180u64;
        assert!(reachable_exact_locked(
            0,
            Piece::S,
            s_mask,
            4,
            Physics::Jstris
        ));
        assert!(reachable_exact_locked(
            s_mask,
            Piece::I,
            i_mask,
            4,
            Physics::Jstris
        ));
        assert!(reachable_exact_locked(
            s_mask | i_mask,
            Piece::Z,
            z_mask,
            4,
            Physics::Jstris
        ));
        assert!(!reachable_exact_locked(
            s_mask | z_mask,
            Piece::I,
            i_mask,
            4,
            Physics::Jstris
        ));
    }

    #[test]
    fn compact_solution_roundtrip() {
        let compact = CompactSolution::default()
            .with_piece_mask(Piece::I, 0x0000_0000_000f)
            .with_piece_mask(Piece::T, 0x0000_0000_0f00)
            .with_piece_mask(Piece::Z, 0x0000_000f_0000);
        let masks = compact.masks(4);
        assert_eq!(masks[Piece::I as usize], 0x0000_0000_000f);
        assert_eq!(masks[Piece::T as usize], 0x0000_0000_0f00);
        assert_eq!(masks[Piece::Z as usize], 0x0000_000f_0000);
        assert_eq!(masks[Piece::J as usize], 0);
    }

    #[test]
    fn structural_enumerator_counts_playable_piece_orders() {
        let mut solver = PcSolver::new(2);
        let queue = [Piece::O; 6]; // five O pieces fill 2 lines, one is saved
        let solutions = solver.enumerate_pc(0, &queue, true);
        assert!(!solutions.is_empty());
        assert!(solutions.iter().all(|s| s.order_count >= 1));
        let best = solver.per_save_best(0, &queue, true, 16);
        assert_eq!(best.len(), 1);
        assert_eq!(best[0].0, Piece::O);
        assert!(best[0].1.order_count >= 1);
    }

    #[test]
    fn per_save_best_is_exact_beyond_legacy_candidate_limit() {
        let board = 0x3c0f03c0fu64;
        let queue = [
            Piece::O,
            Piece::Z,
            Piece::I,
            Piece::L,
            Piece::J,
            Piece::S,
            Piece::T,
        ];
        let mut solver = PcSolver::new(4);
        let all = solver.enumerate_pc(board, &queue, true);
        let mut expected: [Option<Solution>; 7] = [None; 7];
        for candidate in all {
            let saved = PcSolver::saved_piece_for_solution(&queue, &candidate);
            if saved >= 7 {
                continue;
            }
            let slot = &mut expected[saved as usize];
            let replace = match slot {
                None => true,
                Some(current) if candidate.order_count != current.order_count => {
                    candidate.order_count > current.order_count
                }
                Some(current) => {
                    PcSolver::solution_key_cmp(&candidate.masks, &current.masks).is_lt()
                }
            };
            if replace {
                *slot = Some(candidate);
            }
        }
        let direct = solver.per_save_best(board, &queue, true, 16);
        for (piece, actual) in direct {
            let expected = expected[piece as usize].expect("expected save result");
            assert_eq!(actual.order_count, expected.order_count);
            assert_eq!(actual.masks, expected.masks);
        }
    }

    #[test]
    fn best_pc_matches_full_enumeration_ranking() {
        let board = 0x3c0f03c0fu64;
        let queue = [
            Piece::O,
            Piece::J,
            Piece::I,
            Piece::L,
            Piece::S,
            Piece::Z,
            Piece::T,
        ];
        let mut solver = PcSolver::new(4);
        let mut all = solver.enumerate_pc(board, &queue, true);
        assert_eq!(all.len(), 44);
        all.sort_by(|left, right| {
            right
                .order_count
                .cmp(&left.order_count)
                .then_with(|| PcSolver::solution_key_cmp(&left.masks, &right.masks))
        });
        let expected = all[0];
        let actual = solver.best_pc(board, &queue, true).expect("best PC");
        assert_eq!(actual.masks, expected.masks);
        assert_eq!(actual.order_count, expected.order_count);
    }

    #[test]
    fn solution_key_comparator_matches_string_order() {
        let samples = [
            [0, 0, 0, 0, 0, 0, 0],
            [0xf, 0x10, 0xa, 0x9, 0x100, 0xabcd, 1],
            [0x10, 0xf, 0xb, 0x90, 0x101, 0xabce, 2],
            [u64::MAX, 1, 2, 3, 4, 5, 6],
        ];
        for left in &samples {
            for right in &samples {
                assert_eq!(
                    PcSolver::solution_key_cmp(left, right),
                    PcSolver::solution_key(left).cmp(&PcSolver::solution_key(right))
                );
            }
        }
    }

    #[test]
    fn saved_piece_is_derived_from_solution_multiset() {
        let mut solver = PcSolver::new(2);
        let queue = [Piece::O; 6];
        let solutions = solver.enumerate_pc(0, &queue, true);
        assert!(!solutions.is_empty());
        assert!(
            solutions.iter().all(
                |solution| PcSolver::saved_piece_for_solution(&queue, solution) == Piece::O as u8
            )
        );
    }

    #[test]
    fn compatibility_pattern_existence_matches_scalar_batch() {
        let board = FULL_ROW | (FULL_ROW << 10) | (FULL_ROW << 20);
        let queues = [
            encode_queue_ascii("OOOOO").unwrap(),
            encode_queue_ascii("IIIII").unwrap(),
            encode_queue_ascii("TILJS").unwrap(),
            encode_queue_ascii("ZOSLT").unwrap(),
        ];
        let lengths = [5u8; 4];
        let mut pattern = [0u8; 4];
        let mut scalar = [0u8; 4];
        let mut solver = PcSolver::new(5);
        assert!(solver.can_pc_pattern_many_packed(board, &queues, &lengths, true, &mut pattern));
        assert!(solver.can_pc_many_packed(board, &queues, &lengths, true, &mut scalar));
        assert_eq!(pattern, scalar);
    }

    #[test]
    fn reverse_contains_simple_predecessor() {
        let ps = geometric_predecessors(full_board(2), 2);
        assert!(!ps.is_empty());
        assert!(ps.iter().all(|b| b.count_ones() == 16))
    }

    // ── column_run_reject unit tests ─────────────────────────────────────────

    #[test]
    fn column_run_reject_empty_h4_is_false() {
        // 4L empty: 40 empty cells, one fully connected run, 40 % 4 = 0.
        assert!(!column_run_reject(0, 4));
    }

    #[test]
    fn column_run_reject_connected_with_complete_rows_is_false() {
        // h=5 with 3 complete rows: 20 empty cells in rows 3-4, all connected.
        let b5 = FULL_ROW | (FULL_ROW << 10) | (FULL_ROW << 20);
        assert!(!column_run_reject(b5, 5));
        // h=6 with 2 complete rows: 40 empty cells in rows 2-5, all connected.
        let b6 = FULL_ROW | (FULL_ROW << 10);
        assert!(!column_run_reject(b6, 6));
    }

    #[test]
    fn column_run_reject_full_board_is_always_false() {
        // Fully filled: no empty cells, every run has 0 empty -> 0 % 4 = 0.
        for h in [4u8, 5, 6] {
            assert!(!column_run_reject(full_board(h), h), "h={h}");
        }
    }

    #[test]
    fn column_run_reject_isolated_run_non_mod4_returns_true() {
        // Col 2 completely filled -> isolates cols 0-1 from the rest.
        // Cols 0-1 each have row 3 filled (1 cell), so 3 empty cells each = 6 total.
        // 6 % 4 != 0 -> reject.
        let board: u64 = (1 << 30) | (1 << 31) // col 0 and col 1, row 3 filled
            | (1 << 2) | (1 << 12) | (1 << 22) | (1 << 32); // col 2 all filled
        assert!(column_run_reject(board, 4));
    }

    #[test]
    fn column_run_reject_balanced_split_returns_false() {
        // Col 4 completely filled -> splits into two runs: cols 0-3 (16 empty)
        // and cols 5-9 (20 empty). Both are mod 4.
        let board: u64 = (1 << 4) | (1 << 14) | (1 << 24) | (1 << 34);
        assert!(!column_run_reject(board, 4));
    }

    #[test]
    fn column_run_reject_unbalanced_split_returns_true() {
        // Col 3 completely filled -> left run cols 0-2 has 3*4=12 cells (mod 4 ok),
        // col 3 empty = 0 (ok), right run cols 4-9 has 6*4=24 cells (ok). Fine.
        // But if we also fill one cell of col 0 -> left run has 11 empty -> reject.
        let col3_full: u64 = (1 << 3) | (1 << 13) | (1 << 23) | (1 << 33);
        let extra: u64 = 1 << 0; // col 0, row 0 filled
        let board = col3_full | extra;
        // col_empty[0] = 0b1110 (3 bits), col_empty[1] = 0b1111 (4), col_empty[2] = 0b1111 (4)
        // Run 0-2: 3+4+4 = 11 empty, 11 % 4 != 0 -> true
        assert!(column_run_reject(board, 4));
    }

    #[test]
    fn column_run_reject_completed_rows_not_counted() {
        // Two completed rows at bottom (rows 0-1 = normalized bottom).
        // The full rows contribute no empty cells; only rows 2-3 matter.
        // With rows 2-3 all empty and no splits -> 2*10 = 20 empty, 20 % 4 = 0.
        let complete_two = FULL_ROW | (FULL_ROW << 10);
        assert!(!column_run_reject(complete_two, 4));
    }

    #[test]
    fn column_run_reject_completed_rows_with_bad_remainder() {
        // Two completed rows at bottom; col 2 fully filled in rows 2-3 too.
        // Cols 0-1 in rows 2-3 have 1 extra cell filled -> 3 empty each = 6 total.
        // 6 % 4 != 0 -> reject.
        let complete_two: u64 = FULL_ROW | (FULL_ROW << 10);
        let col2_top: u64 = (1 << 22) | (1 << 32);
        let col0_one: u64 = 1 << 20; // col 0, row 2 filled
        let col1_one: u64 = 1 << 21; // col 1, row 2 filled
        let board = complete_two | col2_top | col0_one | col1_one;
        // col_empty[0]: rows 2-3 -> row 2 filled, row 3 empty -> bit 3 only -> 1 empty
        // col_empty[1]: row 2 filled, row 3 empty -> 1 empty
        // col_empty[2]: both rows 2-3 filled -> 0 empty
        // gap 0/1: col_empty[0] & col_empty[1] = (1<<3) & (1<<3) = != 0 -> connected
        // gap 1/2: col_empty[1] & col_empty[2] = (1<<3) & 0 = 0 -> disconnected
        // run 0-1: 1+1 = 2, 2 % 4 != 0 -> true
        assert!(column_run_reject(board, 4));
    }

    #[test]
    fn column_run_reject_height5_6_basic() {
        // At h=5, an empty board has 50 empty cells = 50 % 4 != 0.
        // But the pc engine only calls this on child states where remaining_cells
        // is already a multiple of 4.  Test with a board that has a bad split.
        // Col 1 completely filled at h=5 -> col 0 has 5 empty cells, 5 % 4 != 0.
        let col1_h5: u64 = (1 << 1) | (1 << 11) | (1 << 21) | (1 << 31) | (1 << 41);
        assert!(column_run_reject(col1_h5, 5));
        // Col 1 completely filled at h=6 -> col 0 has 6 empty cells, 6 % 4 != 0.
        let col1_h6: u64 = (1 << 1) | (1 << 11) | (1 << 21) | (1 << 31) | (1 << 41) | (1 << 51);
        assert!(column_run_reject(col1_h6, 6));
        // Symmetric: col 8 fully filled at h=6 -> col 9 alone has 6 empty cells.
        let col8_h6: u64 = (1 << 8) | (1 << 18) | (1 << 28) | (1 << 38) | (1 << 48) | (1 << 58);
        assert!(column_run_reject(col8_h6, 6));
    }

    // ── No productive child rejected ──────────────────────────────────────────

    // For every board reachable by placing one tetromino on `start_board`,
    // if column_run_reject returns true, verify the child board is not solvable
    // by any of the supplied `probe_queues`.  Multiple queues widen coverage
    // when no single queue reaches all solvable completions.
    //
    // Primary soundness for h=5/6 comes from the fingerprint tests below
    // (pattern vs. independent scalar solver).  These tests are structural
    // insurance: they catch any falsely-rejected board whose completion is
    // reachable by at least one probe queue.
    fn verify_no_productive_child_rejected(
        height: u8,
        start_board: u64,
        pieces_after_one: u8,
        probe_queues: &[Vec<Piece>],
    ) {
        let mut solver = PcSolver::new(height);
        for &piece in &Piece::ALL {
            let placements = reachable_placements(start_board, piece, height);
            for pl in placements {
                if pl.board == full_board(height) {
                    continue;
                }
                let remaining_cells = height as u32 * 10 - pl.board.count_ones();
                if remaining_cells != pieces_after_one as u32 * 4 {
                    continue;
                }
                if column_run_reject(pl.board, height) {
                    for queue in probe_queues {
                        assert!(
                            !solver.can_pc(pl.board, queue, true),
                            "column_run_reject falsely rejected solvable board \
                             {:#x} h={height} piece={piece:?}",
                            pl.board
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn column_run_reject_soundness_h4() {
        // 4L empty: 40 cells, 10 pieces needed.  After placing 1: 9 remain.
        let queues: Vec<Vec<Piece>> = vec![
            Piece::ALL.iter().cycle().take(9).copied().collect(),
            [Piece::O; 9].to_vec(),
            [Piece::I; 9].to_vec(),
            Piece::ALL.iter().rev().cycle().take(9).copied().collect(),
        ];
        verify_no_productive_child_rejected(4, 0, 9, &queues);
    }

    #[test]
    fn column_run_reject_soundness_h5() {
        // h=5 with 1 complete row at bottom: 40 empty cells, 10 pieces needed.
        // After placing 1 piece: 9 remain.
        let start = FULL_ROW; // 10 cells filled
        let queues: Vec<Vec<Piece>> = vec![
            Piece::ALL.iter().cycle().take(9).copied().collect(),
            [Piece::O; 9].to_vec(),
            Piece::ALL.iter().rev().cycle().take(9).copied().collect(),
        ];
        verify_no_productive_child_rejected(5, start, 9, &queues);
    }

    #[test]
    fn column_run_reject_soundness_h6() {
        // h=6 empty: 60 cells, 15 pieces needed.  After placing 1: 14 remain.
        let queues: Vec<Vec<Piece>> = vec![
            Piece::ALL.iter().cycle().take(14).copied().collect(),
            [Piece::O; 14].to_vec(),
            Piece::ALL.iter().rev().cycle().take(14).copied().collect(),
        ];
        verify_no_productive_child_rejected(6, 0, 14, &queues);
    }

    // ── Pattern fingerprint: 5L broad-pattern on standard board ──────────────

    #[test]
    fn column_run_reject_5l_pattern_fingerprint_matches_scalar() {
        // Any board reachable from the 5L canonical start with *p7 and *!
        // should give the same solution set via both enumerate_pc_pattern_packed
        // and can_pc_many_packed.  The scalar solver is the independent oracle.
        // This also covers completed-row normalization: the start board has 3
        // complete rows, leaving 2 rows (h=5 total) of empty cells.
        let start = FULL_ROW | (FULL_ROW << 10) | (FULL_ROW << 20); // 3 complete rows
        let queues = [
            encode_queue_ascii("IJLOTS").unwrap(),
            encode_queue_ascii("ZSTILO").unwrap(),
            encode_queue_ascii("OJILTZ").unwrap(),
        ];
        let lengths = [6u8, 6, 6];
        let mut pattern_out = [0u8; 3];
        let mut scalar_out = [0u8; 3];
        let mut solver = PcSolver::new(5);
        assert!(solver.can_pc_pattern_many_packed(
            start,
            &queues,
            &lengths,
            true,
            &mut pattern_out
        ));
        assert!(solver.can_pc_many_packed(start, &queues, &lengths, true, &mut scalar_out));
        assert_eq!(
            pattern_out, scalar_out,
            "pattern != scalar after column_run filter"
        );
    }

    #[test]
    fn column_run_reject_6l_pattern_fingerprint_matches_scalar() {
        let start =
            FULL_ROW | (FULL_ROW << 10) | (FULL_ROW << 20) | (FULL_ROW << 30) | (FULL_ROW << 40); // 5 complete rows, 1 left
        let queues = [
            encode_queue_ascii("IJLOTS").unwrap(),
            encode_queue_ascii("ZSTILO").unwrap(),
        ];
        let lengths = [6u8, 6];
        let mut pattern_out = [0u8; 2];
        let mut scalar_out = [0u8; 2];
        let mut solver = PcSolver::new(6);
        assert!(solver.can_pc_pattern_many_packed(
            start,
            &queues,
            &lengths,
            true,
            &mut pattern_out
        ));
        assert!(solver.can_pc_many_packed(start, &queues, &lengths, true, &mut scalar_out));
        assert_eq!(
            pattern_out, scalar_out,
            "pattern != scalar after column_run filter"
        );
    }

    // Regression: when perm[] is omitted from the remap in either emission
    // path, covered bits are written at the DFS index rather than the original
    // case ID. This test guarantees both paths remap correctly by placing queues
    // in reversed DFS order (case 0 = "ZZZZZ", case 1 = "OOOOO"; DFS visits
    // O-path first because O(3) < Z(6)), so a missing remap swaps the outputs.
    #[test]
    fn queue_trie_interval_remap_both_paths() {
        // 5-line board, bottom 3 rows filled → 20 empty cells, req = 5 pieces.
        let board = FULL_ROW | (FULL_ROW << 10) | (FULL_ROW << 20);
        // case 0: Z-first (DFS visits later)
        // case 1: O-first (DFS visits earlier, so perm[0] = 1, perm[1] = 0)
        let qbits = [
            encode_queue_ascii("ZZZZZ").unwrap(),
            encode_queue_ascii("OOOOO").unwrap(),
        ];
        let qlens = [5u8; 2];

        let mut solver = PcSolver::new(5);

        // Ground truth from single-queue solver.
        let ooooo: Vec<Piece> = (0..5).map(|_| Piece::O).collect();
        let zzzzz: Vec<Piece> = (0..5).map(|_| Piece::Z).collect();
        let expect0 = solver.can_pc(board, &zzzzz, true) as u8;
        let expect1 = solver.can_pc(board, &ooooo, true) as u8;

        // can_pc_pattern_many_packed remap test.
        let mut many_out = [0u8; 2];
        assert!(solver.can_pc_pattern_many_packed(board, &qbits, &qlens, true, &mut many_out));
        assert_eq!(
            many_out[0], expect0,
            "can_pc_pattern_many_packed: case 0 (ZZZZZ) wrong — perm[] missing?"
        );
        assert_eq!(
            many_out[1], expect1,
            "can_pc_pattern_many_packed: case 1 (OOOOO) wrong — perm[] missing?"
        );

        // enumerate_pc_pattern_packed remap test: every case in the coverage
        // set of every solution must be a valid original case ID, and the union
        // must agree with the can_pc ground truth.
        let enum_out = solver
            .enumerate_pc_pattern_packed(board, &qbits, &qlens, true)
            .unwrap();
        let mut covered = [false; 2];
        for row in &enum_out {
            for &(case, _) in &row.cases {
                assert!(
                    (case as usize) < 2,
                    "enumerate_pc_pattern_packed: case ID {case} out of range — perm[] missing?"
                );
                covered[case as usize] = true;
            }
        }
        assert_eq!(
            covered[0],
            expect0 != 0,
            "enumerate_pc_pattern_packed: case 0 (ZZZZZ) coverage wrong"
        );
        assert_eq!(
            covered[1],
            expect1 != 0,
            "enumerate_pc_pattern_packed: case 1 (OOOOO) coverage wrong"
        );
    }

    // Complete differential parity helper: verifies DFS-interval representation
    // produces the same results as scalar single-queue can_pc/enumerate_pc for
    // every dimension: hold on/off, exact existence, original case ordering,
    // per-solution exact masks, per-solution case membership, per-case
    // playableOrderCount, and the full min_cover pipeline (selected solution
    // masks + quality vector).
    fn assert_pattern_parity(
        board: u64,
        height: u8,
        qbits: &[u64],
        qlens: &[u8],
        use_hold: bool,
        label: &str,
    ) {
        let n_cases = qbits.len();
        let mut solver = PcSolver::new(height);

        // --- Scalar ground truth per case ---
        let expected_can_pc: Vec<u8> = qbits
            .iter()
            .zip(qlens)
            .map(|(&b, &l)| {
                let q: Vec<Piece> = (0..l)
                    .map(|i| PcSolver::packed_piece(b, i).unwrap())
                    .collect();
                solver.can_pc(board, &q, use_hold) as u8
            })
            .collect();

        // Scalar per-case enumerate_pc results.
        let scalar_per_case: Vec<Vec<Solution>> = qbits
            .iter()
            .zip(qlens)
            .map(|(&b, &l)| {
                let q: Vec<Piece> = (0..l)
                    .map(|i| PcSolver::packed_piece(b, i).unwrap())
                    .collect();
                solver.enumerate_pc(board, &q, use_hold)
            })
            .collect();

        // --- can_pc_pattern_many_packed: existence parity ---
        let mut out_many = vec![0u8; n_cases];
        assert!(
            solver.can_pc_pattern_many_packed(board, qbits, qlens, use_hold, &mut out_many),
            "{label}: can_pc_pattern_many_packed returned false"
        );
        assert_eq!(
            out_many, expected_can_pc,
            "{label}: can_pc_pattern_many_packed existence parity hold={use_hold}"
        );

        // --- enumerate_pc_pattern_packed: full parity ---
        let enum_rows = solver
            .enumerate_pc_pattern_packed(board, qbits, qlens, use_hold)
            .unwrap();

        // 1. All case IDs in range; build union.
        let mut union = vec![false; n_cases];
        for row in &enum_rows {
            assert!(
                row.solution.order_count >= 1,
                "{label}: solution order_count=0"
            );
            for &(case, order_count) in &row.cases {
                assert!(
                    (case as usize) < n_cases,
                    "{label}: case ID {case} out of range hold={use_hold}"
                );
                assert!(
                    order_count >= 1,
                    "{label}: per-case order_count=0 at case {case}"
                );
                union[case as usize] = true;
            }
        }
        for (i, (&u, &e)) in union.iter().zip(&expected_can_pc).enumerate() {
            assert_eq!(
                u,
                e != 0,
                "{label}: coverage union mismatch at case {i} hold={use_hold}"
            );
        }

        // 2. Per-solution exact masks and per-solution case membership.
        for row in &enum_rows {
            let masks = row.solution.masks;

            let mut expected_cases: Vec<(u32, u32)> = Vec::new();
            for (case_idx, scalar_sols) in scalar_per_case.iter().enumerate() {
                if let Some(s) = scalar_sols.iter().find(|s| s.masks == masks) {
                    expected_cases.push((case_idx as u32, s.order_count));
                }
            }
            expected_cases.sort_unstable();

            let mut actual_cases: Vec<(u32, u32)> = row.cases.clone();
            actual_cases.sort_unstable();

            assert_eq!(
                actual_cases, expected_cases,
                "{label}: case membership/playableOrderCount mismatch for geometry \
                 {:?} hold={use_hold}",
                masks
            );
        }

        // 3. Determinism: identical call must produce identical mask order.
        let enum_rows2 = solver
            .enumerate_pc_pattern_packed(board, qbits, qlens, use_hold)
            .unwrap();
        let masks1: Vec<_> = enum_rows.iter().map(|r| r.solution.masks).collect();
        let masks2: Vec<_> = enum_rows2.iter().map(|r| r.solution.masks).collect();
        assert_eq!(
            masks1, masks2,
            "{label}: non-deterministic mask order hold={use_hold}"
        );

        // 4. min_cover pipeline: final selected solution masks and quality vector.
        let all_solvable = expected_can_pc.iter().all(|&v| v != 0);
        if all_solvable {
            let n_solutions = enum_rows.len();

            let mut raw_cases_p2: Vec<Vec<(u32, u32)>> = vec![Vec::new(); n_cases];
            for (sol_idx, row) in enum_rows.iter().enumerate() {
                for &(case, order_count) in &row.cases {
                    raw_cases_p2[case as usize].push((sol_idx as u32, order_count));
                }
            }

            let mut scalar_masks_ordered: Vec<[u64; 7]> = Vec::new();
            let mut scalar_mask_to_idx: FastMap<[u64; 7], usize> =
                FastMap::with_hasher(FastBuildHasher::default());
            let mut raw_cases_scalar: Vec<Vec<(u32, u32)>> = vec![Vec::new(); n_cases];
            for (case_idx, scalar_sols) in scalar_per_case.iter().enumerate() {
                for s in scalar_sols {
                    let idx = scalar_mask_to_idx.len();
                    let sol_idx = *scalar_mask_to_idx.entry(s.masks).or_insert_with(|| {
                        scalar_masks_ordered.push(s.masks);
                        idx
                    });
                    raw_cases_scalar[case_idx].push((sol_idx as u32, s.order_count));
                }
            }
            let n_scalar_solutions = scalar_masks_ordered.len();

            let result_p2 = min_cover::exact_minimum_cover(&raw_cases_p2, n_solutions);
            let result_scalar =
                min_cover::exact_minimum_cover(&raw_cases_scalar, n_scalar_solutions);

            match (result_p2, result_scalar) {
                (Some(rp), Some(rs)) => {
                    assert_eq!(
                        rp.quality, rs.quality,
                        "{label}: min_cover quality vector mismatch hold={use_hold}"
                    );
                    let mut sel_p2: Vec<[u64; 7]> = rp
                        .selected
                        .iter()
                        .map(|&i| enum_rows[i as usize].solution.masks)
                        .collect();
                    let mut sel_scalar: Vec<[u64; 7]> = rs
                        .selected
                        .iter()
                        .map(|&i| scalar_masks_ordered[i as usize])
                        .collect();
                    sel_p2.sort_unstable();
                    sel_scalar.sort_unstable();
                    assert_eq!(
                        sel_p2, sel_scalar,
                        "{label}: min_cover selected masks mismatch hold={use_hold}"
                    );
                }
                (None, None) => {}
                _ => panic!("{label}: min_cover returned Some vs None mismatch hold={use_hold}"),
            }
        }
    }

    // --- C2 pre-frontier empty-anchor tests ---

    // Verify the C2 precondition directly: for every orientation, valid[o] & inside[o] == 0.
    // Uses a fully-occupied board so every placement is blocked and valid[o] == 0.
    #[test]
    fn c2_early_return_fully_occupied() {
        for h in 2u8..=6 {
            let board = board_mask(h);
            let (valid, inside) = valid_anchor_masks(board, Piece::I, h);
            for o in 0..4 {
                assert_eq!(
                    valid[o] & inside[o],
                    0,
                    "C2 precondition must hold: h={h} o={o}"
                );
            }
            for p in Piece::ALL {
                let placements = reachable_placements(board, p, h);
                assert!(
                    placements.is_empty(),
                    "C2 early return must yield empty result: h={h} p={p:?}"
                );
            }
        }
    }

    // Verify C2 fires for I-piece when no inside positions overlap valid positions:
    // at height=2 with all cells filled except exactly 3 contiguous cells in row 0,
    // the I-piece horizontal cannot lock (needs 4 contiguous), and I-piece vertical
    // needs 4 rows (inside[1/3] is zero for h=2). All other orientations are also
    // blocked by the filled cells.
    #[test]
    fn c2_early_return_impossible_gap() {
        // 3 consecutive cells empty in bottom row, all others filled.
        // I horizontal needs 4; blocked. I vertical: inside == 0 for h=2. => C2.
        let full = board_mask(2);
        // clear bits 1,2,3 (columns 1,2,3 of row 0)
        let board = full & !(0b1110u64);
        let (valid, inside) = valid_anchor_masks(board, Piece::I, 2);
        for o in 0..4 {
            assert_eq!(
                valid[o] & inside[o],
                0,
                "C2 precondition for I-piece impossible gap: o={o}"
            );
        }
        assert!(reachable_placements(board, Piece::I, 2).is_empty());
    }

    // Differential BFS parity for h=5 and h=6 on empty and sample boards.
    // Ensures C2 change does not alter the result on non-C2 inputs.
    #[test]
    fn bitset_matches_bfs_h5_h6() {
        let boards_h5 = [0u64, 0x00000003ff, 0x000003f0c3, 0x0000f030c3];
        for &b in &boards_h5 {
            if b & !board_mask(5) != 0 {
                continue;
            }
            for p in Piece::ALL {
                assert_eq!(
                    sig(reachable_placements(b, p, 5)),
                    sig(reachable_placements_bfs(b, p, 5)),
                    "h=5 b={b:x} p={p:?}"
                );
            }
        }
        for p in Piece::ALL {
            assert_eq!(
                sig(reachable_placements(0, p, 6)),
                sig(reachable_placements_bfs(0, p, 6)),
                "h=6 p={p:?}"
            );
        }
    }

    // Non-C2 inputs: sorted-set parity against BFS reference.
    // Renamed from c2_non_firing_ordering_preserved: sig() sorts both sides,
    // so this is sorted-set equality, not order-sensitive ordering preservation.
    // See c2_ordering_regression for the true order-sensitive oracle.
    #[test]
    fn c2_non_firing_sorted_set_parity() {
        // Each board must have at least one valid inside placement for some piece.
        let cases: &[(u64, Piece, u8)] = &[
            (0, Piece::I, 4),
            (0, Piece::T, 4),
            (0x00000003ff, Piece::S, 4),
            (0, Piece::J, 5),
            (0, Piece::L, 6),
        ];
        for &(board, p, h) in cases {
            let fast = reachable_placements(board, p, h);
            let bfs = sig(reachable_placements_bfs(board, p, h));
            assert_eq!(
                sig(fast.clone()),
                bfs,
                "set mismatch board={board:x} p={p:?} h={h}"
            );
            assert!(
                !fast.is_empty(),
                "test case must be non-C2: board={board:x} p={p:?} h={h}"
            );
        }
    }

    // True order-sensitive regression oracle for the C2 non-firing path.
    //
    // Provenance: sequences are derived from the pre-C2 production (ad54ea2)
    // via the BFS reference implementation (reachable_placements_bfs), which
    // preserves the exact set. When C2 does not fire (valid & inside != 0 for
    // at least one orientation), the DFS code path is bit-for-bit identical
    // to ad54ea2 — the C2 branch is a pure early-return added before the
    // frontier seed, so the non-firing code path is unchanged.
    //
    // We assert raw sequence equality (no sort on either side) to catch any
    // future reordering of the DFS frontier traversal.
    #[test]
    fn c2_ordering_regression() {
        // Key: (post-placement board, x, y, cells). Uniquely identifies each
        // canonical placement without the raw orientation ambiguity that arises
        // for symmetric pieces (S/Z/I have two canonical orientations mapped to
        // four slots; DFS and BFS may emit different slot numbers for the same
        // geometric placement). The `cells` bitmask fully encodes position+shape.
        fn pl_order_key(p: &Placement) -> (u64, i8, i8, u64) {
            (p.board, p.x, p.y, p.cells)
        }
        // Small non-C2 boards with deterministic DFS ordering.
        // board=0 p=O h=2: ~9 placements; DFS visits anchor positions top-down.
        // board=0 p=T h=3: medium; all T orientations in a 3-high field.
        // board=0x3ff p=S h=4: S with bottom row full, known to be non-C2.
        let cases: &[(u64, Piece, u8)] =
            &[(0, Piece::O, 2), (0, Piece::T, 3), (0x3ff, Piece::S, 4)];
        for &(board, p, h) in cases {
            let actual = reachable_placements(board, p, h);
            assert!(
                !actual.is_empty(),
                "C2 fired unexpectedly: b={board:x} p={p:?} h={h}"
            );

            // Determinism: a second call must produce the same sequence without sorting.
            let actual2 = reachable_placements(board, p, h);
            assert_eq!(
                actual.iter().map(pl_order_key).collect::<Vec<_>>(),
                actual2.iter().map(pl_order_key).collect::<Vec<_>>(),
                "non-deterministic output: b={board:x} p={p:?} h={h}"
            );

            // Sorted-set parity against BFS (correctness, not ordering).
            let mut bfs_keys: Vec<_> = reachable_placements_bfs(board, p, h)
                .iter()
                .map(pl_order_key)
                .collect();
            bfs_keys.sort_unstable();
            let mut actual_keys: Vec<_> = actual.iter().map(pl_order_key).collect();
            actual_keys.sort_unstable();
            assert_eq!(
                actual_keys, bfs_keys,
                "set mismatch vs BFS: b={board:x} p={p:?} h={h}"
            );
        }
    }

    // Negative control: swapping two distinct entries in the sequence must cause
    // the order-sensitive comparator to fail.
    #[test]
    fn c2_ordering_negative_control() {
        fn pl_order_key(p: &Placement) -> (u64, i8, i8, u64) {
            (p.board, p.x, p.y, p.cells)
        }
        let mut seq = reachable_placements(0, Piece::T, 3);
        assert!(
            seq.len() >= 2,
            "need at least 2 placements for negative control"
        );
        let orig: Vec<_> = seq.iter().map(pl_order_key).collect();
        // Confirm the first two entries are distinct (otherwise the swap would be invisible).
        assert_ne!(
            orig[0], orig[1],
            "first two placements are identical — swap would be invisible"
        );
        seq.swap(0, 1);
        let swapped: Vec<_> = seq.iter().map(pl_order_key).collect();
        assert_ne!(orig, swapped, "swapping did not change the sequence");
    }

    // Shared frozen-oracle helpers used by c2_frozen_oracle_raw_placement and
    // c2_frozen_oracle_negative_control.

    /// Compact record type for frozen placement expectations.
    #[derive(Debug, PartialEq, Eq)]
    struct FrozenPl {
        board: u64,
        piece: Piece,
        orientation: u8,
        x: i8,
        y: i8,
        raw_board: u64,
        cells: u64,
    }

    /// Compare raw candidate sequence against frozen oracle WITHOUT sorting.
    fn assert_raw_matches(actual: &[Placement], expected: &[FrozenPl], label: &str) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label}: count mismatch (got {}, want {})",
            actual.len(),
            expected.len()
        );
        for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
            assert_eq!(a.board, e.board, "{label}[{i}]: board");
            assert_eq!(a.piece, e.piece, "{label}[{i}]: piece");
            assert_eq!(a.orientation, e.orientation, "{label}[{i}]: orientation");
            assert_eq!(a.x, e.x, "{label}[{i}]: x");
            assert_eq!(a.y, e.y, "{label}[{i}]: y");
            assert_eq!(a.raw_board, e.raw_board, "{label}[{i}]: raw_board");
            assert_eq!(a.cells, e.cells, "{label}[{i}]: cells");
        }
    }

    macro_rules! frozen_pl {
        ($board:expr, $piece:ident, $o:expr, $x:expr, $y:expr, $raw:expr, $cells:expr) => {
            FrozenPl {
                board: $board,
                piece: Piece::$piece,
                orientation: $o,
                x: $x,
                y: $y,
                raw_board: $raw,
                cells: $cells,
            }
        };
    }

    /// Frozen T h=3 oracle (board=0, 34 placements).
    ///
    /// Shared by the positive oracle test and the negative-control test.
    fn frozen_t_h3() -> Vec<FrozenPl> {
        vec![
            frozen_pl!(0x807, T, 0, 0, 0, 0x807, 0x807),
            frozen_pl!(0x100e, T, 0, 1, 0, 0x100e, 0x100e),
            frozen_pl!(0x201c, T, 0, 2, 0, 0x201c, 0x201c),
            frozen_pl!(0x4038, T, 0, 3, 0, 0x4038, 0x4038),
            frozen_pl!(0x8070, T, 0, 4, 0, 0x8070, 0x8070),
            frozen_pl!(0x100e0, T, 0, 5, 0, 0x100e0, 0x100e0),
            frozen_pl!(0x201c0, T, 0, 6, 0, 0x201c0, 0x201c0),
            frozen_pl!(0x40380, T, 0, 7, 0, 0x40380, 0x40380),
            frozen_pl!(0x100c01, T, 1, 0, 0, 0x100c01, 0x100c01),
            frozen_pl!(0x201802, T, 1, 1, 0, 0x201802, 0x201802),
            frozen_pl!(0x403004, T, 1, 2, 0, 0x403004, 0x403004),
            frozen_pl!(0x806008, T, 1, 3, 0, 0x806008, 0x806008),
            frozen_pl!(0x100c010, T, 1, 4, 0, 0x100c010, 0x100c010),
            frozen_pl!(0x2018020, T, 1, 5, 0, 0x2018020, 0x2018020),
            frozen_pl!(0x4030040, T, 1, 6, 0, 0x4030040, 0x4030040),
            frozen_pl!(0x8060080, T, 1, 7, 0, 0x8060080, 0x8060080),
            frozen_pl!(0x100c0100, T, 1, 8, 0, 0x100c0100, 0x100c0100),
            frozen_pl!(0x1c02, T, 2, 0, 0, 0x1c02, 0x1c02),
            frozen_pl!(0x3804, T, 2, 1, 0, 0x3804, 0x3804),
            frozen_pl!(0x7008, T, 2, 2, 0, 0x7008, 0x7008),
            frozen_pl!(0xe010, T, 2, 3, 0, 0xe010, 0xe010),
            frozen_pl!(0x1c020, T, 2, 4, 0, 0x1c020, 0x1c020),
            frozen_pl!(0x38040, T, 2, 5, 0, 0x38040, 0x38040),
            frozen_pl!(0x70080, T, 2, 6, 0, 0x70080, 0x70080),
            frozen_pl!(0xe0100, T, 2, 7, 0, 0xe0100, 0xe0100),
            frozen_pl!(0x200c02, T, 3, 0, 0, 0x200c02, 0x200c02),
            frozen_pl!(0x401804, T, 3, 1, 0, 0x401804, 0x401804),
            frozen_pl!(0x803008, T, 3, 2, 0, 0x803008, 0x803008),
            frozen_pl!(0x1006010, T, 3, 3, 0, 0x1006010, 0x1006010),
            frozen_pl!(0x200c020, T, 3, 4, 0, 0x200c020, 0x200c020),
            frozen_pl!(0x4018040, T, 3, 5, 0, 0x4018040, 0x4018040),
            frozen_pl!(0x8030080, T, 3, 6, 0, 0x8030080, 0x8030080),
            frozen_pl!(0x10060100, T, 3, 7, 0, 0x10060100, 0x10060100),
            frozen_pl!(0x200c0200, T, 3, 8, 0, 0x200c0200, 0x200c0200),
        ]
    }

    // Frozen pre-C2 raw placement-order oracle.
    //
    // Provenance:
    //   source commit: ad54ea2414c1fd505f22d825f6e181b67ec44c9a
    //   lib.rs blob:   25f98c9729cac35a0ebbc2f89890834e5f02cbba (sha256: 40b630aaef6dc8ba018b604721d39fe00e718581cf6ba93c7fbd1ddfbb25f734)
    //   generated by:  standalone oracle-gen binary (oracle-gen harness) calling
    //                  reachable_placements directly against the ad54ea2 source;
    //                  output captured verbatim as the constants below.
    //
    // The expected sequences are immutable constants. The test compares raw
    // candidate output field-by-field in emission order WITHOUT sorting or
    // normalization on either side. Any reordering of the DFS frontier traversal
    // or any field mutation will cause a mismatch here.
    //
    // All three cases are non-C2 (valid & inside != 0 for at least one
    // orientation), so the DFS code path is identical to ad54ea2.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn c2_frozen_oracle_raw_placement() {
        // --- Case 1: board=0 piece=O h=2 (9 placements) ---
        // Generated from ad54ea2 oracle-gen; O has one orientation (o=0); anchor is bottom-left.
        let expected_o_h2: &[FrozenPl] = &[
            frozen_pl!(0xc03, O, 0, 0, 0, 0xc03, 0xc03),
            frozen_pl!(0x1806, O, 0, 1, 0, 0x1806, 0x1806),
            frozen_pl!(0x300c, O, 0, 2, 0, 0x300c, 0x300c),
            frozen_pl!(0x6018, O, 0, 3, 0, 0x6018, 0x6018),
            frozen_pl!(0xc030, O, 0, 4, 0, 0xc030, 0xc030),
            frozen_pl!(0x18060, O, 0, 5, 0, 0x18060, 0x18060),
            frozen_pl!(0x300c0, O, 0, 6, 0, 0x300c0, 0x300c0),
            frozen_pl!(0x60180, O, 0, 7, 0, 0x60180, 0x60180),
            frozen_pl!(0xc0300, O, 0, 8, 0, 0xc0300, 0xc0300),
        ];
        let actual_o_h2 = reachable_placements(0, Piece::O, 2);
        assert!(
            !actual_o_h2.is_empty(),
            "oracle: board=0 O h=2 must be non-C2"
        );
        assert_raw_matches(&actual_o_h2, expected_o_h2, "O_h2");

        // --- Case 2: board=0 piece=T h=3 (34 placements) ---
        // T has 4 orientations (0-3); DFS visits orientations in order, anchor top-down.
        let expected_t_h3 = frozen_t_h3();
        let actual_t_h3 = reachable_placements(0, Piece::T, 3);
        assert!(
            !actual_t_h3.is_empty(),
            "oracle: board=0 T h=3 must be non-C2"
        );
        assert_raw_matches(&actual_t_h3, &expected_t_h3, "T_h3");

        // --- Case 3: board=0x3ff piece=S h=4 (17 placements) ---
        // S with full bottom row; two canonical orientations (0 and 1).
        let expected_s_h4: &[FrozenPl] = &[
            frozen_pl!(0x600fff, S, 0, 0, 1, 0x600fff, 0x600c00),
            frozen_pl!(0xc01bff, S, 0, 1, 1, 0xc01bff, 0xc01800),
            frozen_pl!(0x18033ff, S, 0, 2, 1, 0x18033ff, 0x1803000),
            frozen_pl!(0x30063ff, S, 0, 3, 1, 0x30063ff, 0x3006000),
            frozen_pl!(0x600c3ff, S, 0, 4, 1, 0x600c3ff, 0x600c000),
            frozen_pl!(0xc0183ff, S, 0, 5, 1, 0xc0183ff, 0xc018000),
            frozen_pl!(0x180303ff, S, 0, 6, 1, 0x180303ff, 0x18030000),
            frozen_pl!(0x300603ff, S, 0, 7, 1, 0x300603ff, 0x30060000),
            frozen_pl!(0x40300bff, S, 1, 0, 1, 0x40300bff, 0x40300800),
            frozen_pl!(0x806013ff, S, 1, 1, 1, 0x806013ff, 0x80601000),
            frozen_pl!(0x100c023ff, S, 1, 2, 1, 0x100c023ff, 0x100c02000),
            frozen_pl!(0x2018043ff, S, 1, 3, 1, 0x2018043ff, 0x201804000),
            frozen_pl!(0x4030083ff, S, 1, 4, 1, 0x4030083ff, 0x403008000),
            frozen_pl!(0x8060103ff, S, 1, 5, 1, 0x8060103ff, 0x806010000),
            frozen_pl!(0x100c0203ff, S, 1, 6, 1, 0x100c0203ff, 0x100c020000),
            frozen_pl!(0x20180403ff, S, 1, 7, 1, 0x20180403ff, 0x2018040000),
            frozen_pl!(0x40300803ff, S, 1, 8, 1, 0x40300803ff, 0x4030080000),
        ];
        let actual_s_h4 = reachable_placements(0x3ff, Piece::S, 4);
        assert!(
            !actual_s_h4.is_empty(),
            "oracle: board=0x3ff S h=4 must be non-C2"
        );
        assert_raw_matches(&actual_s_h4, expected_s_h4, "S_h4");
    }

    // Negative control for c2_frozen_oracle_raw_placement.
    //
    // Deliberately perturbs the candidate sequence (swaps two entries) and
    // passes it through the SAME assert_raw_matches comparator against the SAME
    // frozen_t_h3() expectation. Proves the comparator detects the perturbation.
    #[test]
    fn c2_frozen_oracle_negative_control() {
        // Obtain actual sequence and swap entries 0 and 1 (confirmed distinct).
        let mut perturbed = reachable_placements(0, Piece::T, 3);
        assert!(perturbed.len() >= 2, "need ≥2 placements");
        assert_ne!(
            perturbed[0].board, perturbed[1].board,
            "pre-condition: first two T h=3 placements must differ"
        );
        perturbed.swap(0, 1);

        // Pass the perturbed sequence through the shared comparator against the
        // shared frozen expectation. This must panic (= fail the comparison).
        let expected = frozen_t_h3();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_raw_matches(&perturbed, &expected, "negative_control_T_h3");
        }));
        assert!(
            result.is_err(),
            "negative control: oracle comparison must fail on perturbed sequence"
        );
    }

    // Physics::Jstris and Physics::Tetrio explicit C2 and non-C2 coverage.
    //
    // C2 condition (valid[o] & inside[o] == 0 for all o) is physics-independent:
    // valid and inside depend only on board occupancy and height, not kick tables.
    // Both physics variants must fire/not-fire identically for the same board.
    #[test]
    fn c2_physics_jstris_and_tetrio_firing() {
        // Board with exactly one 4-cell vertical column free (col 0, rows 0-3 for h=5).
        // T-piece (all orientations ≥2 cells wide) cannot fit in a 1-wide column.
        // → valid[o] = 0 for all T orientations → C2 fires → empty result.
        let free = 1u64 | (1 << 10) | (1 << 20) | (1 << 30);
        let board = board_mask(5) ^ free;
        // Confirm exactly 4 cells free (sanity check).
        assert_eq!(
            (board_mask(5) & !board).count_ones(),
            4,
            "board construction error"
        );
        for physics in [Physics::Jstris, Physics::Tetrio] {
            let r = reachable_placements_with_physics(board, Piece::T, 5, physics);
            assert!(
                r.is_empty(),
                "C2 should fire for T-piece in 1-wide column: physics={physics:?}"
            );
        }
        // Fully-occupied board: all pieces, all heights 2..=4, both physics.
        for h in 2u8..=4 {
            let full = board_mask(h);
            for p in Piece::ALL {
                for physics in [Physics::Jstris, Physics::Tetrio] {
                    let r = reachable_placements_with_physics(full, p, h, physics);
                    assert!(
                        r.is_empty(),
                        "C2 should fire on full board: h={h} p={p:?} physics={physics:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn c2_physics_jstris_and_tetrio_non_firing() {
        // All 7 pieces on empty board at heights 2..=4: both physics must produce
        // non-empty results and identical sorted sets (empty board → no kick needed).
        let board = 0u64;
        for h in 2u8..=4 {
            for p in Piece::ALL {
                let r_j = reachable_placements_with_physics(board, p, h, Physics::Jstris);
                let r_t = reachable_placements_with_physics(board, p, h, Physics::Tetrio);
                assert!(!r_j.is_empty(), "Jstris {p:?} h={h}: expected non-empty");
                assert!(!r_t.is_empty(), "Tetrio {p:?} h={h}: expected non-empty");
                // Empty board requires no rotation kicks, so results must match.
                assert_eq!(
                    sig(r_j),
                    sig(r_t),
                    "{p:?} h={h}: Jstris vs Tetrio must match on empty board"
                );
            }
        }
    }

    // Direct C2 regression for generic_finish_placement (the 5..=6-line last-piece
    // fast path that carries the same C2 early return as reachable_placements_with_physics).
    //
    // Board: h=5 with exactly a 1-wide vertical column free (col 0, rows 0-3).
    // Piece: T (all orientations ≥2 wide, so valid[o] = 0 for all o).
    // Expected: C2 fires inside generic_finish_placement → returns None.
    //
    // Non-C2 case: h=5 with exactly 4 cells free forming an I-horizontal shape
    // at the bottom row, piece I → generic_finish_placement returns Some(_).
    #[test]
    fn generic_finish_c2_regression() {
        // C2-firing case: T cannot fit in a single-column hole at h=5.
        let free_col = 1u64 | (1 << 10) | (1 << 20) | (1 << 30);
        let board_col = board_mask(5) ^ free_col;
        let solver = PcSolver::new(5);
        let result = solver.generic_finish_placement(board_col, Piece::T);
        assert!(
            result.is_none(),
            "generic_finish_placement: C2 must fire for T in 1-wide column"
        );

        // Non-C2 case: I-horizontal fits exactly in a 4-cell gap at the TOP row (row 4),
        // which is reachable from spawn (rows 5,6 above the playfield).
        // A bottom-row gap sealed by full rows above is unreachable from spawn.
        let free_top = 0xf_u64 << 40; // cols 0-3 at row 4 (bits 40-43)
        let board_top = board_mask(5) & !free_top;
        let result2 = solver.generic_finish_placement(board_top, Piece::I);
        assert!(
            result2.is_some(),
            "generic_finish_placement: I-horizontal must find the top-row gap"
        );
        let pl = result2.unwrap();
        // Verify the returned placement covers exactly the 4 free cells.
        assert_eq!(
            pl.cells, free_top,
            "I-horizontal placement must cover the exact gap"
        );
    }

    // Complete differential parity across hold on/off and heights 4/5/6.
    // Covers: original case ordering, duplicate queues, variable queue lengths,
    // exact solution masks, per-solution case membership, every
    // playableOrderCount, final selected IDs (via min_cover), and complete
    // qualityVector.
    #[test]
    fn queue_trie_interval_parity_matrix() {
        // --- 4L: 2 rows filled → 20 empty cells, req=5 ---
        let board_4l = FULL_ROW | (FULL_ROW << 10);
        let queues_4l: &[(&str, u8)] = &[
            ("OOOOO", 5),
            ("TILJS", 5),
            ("ZOSLT", 5),
            ("OOOOO", 5), // deliberate duplicate
            ("LJSZT", 5),
        ];
        let qbits_4l: Vec<u64> = queues_4l
            .iter()
            .map(|(s, _)| encode_queue_ascii(s).unwrap())
            .collect();
        let qlens_4l: Vec<u8> = queues_4l.iter().map(|&(_, l)| l).collect();
        for &use_hold in &[true, false] {
            assert_pattern_parity(board_4l, 4, &qbits_4l, &qlens_4l, use_hold, "4L");
        }

        // --- 5L: 3 rows filled → req=5; includes duplicate queues and
        //         variable lengths (5-piece and 6-piece in the same batch) ---
        let board3 = FULL_ROW | (FULL_ROW << 10) | (FULL_ROW << 20);
        let queues_5l: &[(&str, u8)] = &[
            ("OOOOO", 5),
            ("IIIII", 5),
            ("TILJS", 5),
            ("ZOSLT", 5),
            ("OOOOO", 5), // deliberate duplicate
            ("LJSZT", 5),
            ("ZZZZZ", 5),
            ("TIIJLS", 6), // variable length: 6-piece queue on a 5-req board
            ("ZOOSLT", 6),
        ];
        let qbits_5l: Vec<u64> = queues_5l
            .iter()
            .map(|(s, _)| encode_queue_ascii(s).unwrap())
            .collect();
        let qlens_5l: Vec<u8> = queues_5l.iter().map(|&(_, l)| l).collect();
        for &use_hold in &[true, false] {
            assert_pattern_parity(board3, 5, &qbits_5l, &qlens_5l, use_hold, "5L");
        }

        // --- 6L: 4 rows filled → req=5 ---
        let board4 = FULL_ROW | (FULL_ROW << 10) | (FULL_ROW << 20) | (FULL_ROW << 30);
        let qbits_6l = &qbits_5l[..7]; // first 7 (all len=5)
        let qlens_6l = &qlens_5l[..7];
        for &use_hold in &[true, false] {
            assert_pattern_parity(board4, 6, qbits_6l, qlens_6l, use_hold, "6L");
        }
    }

    // Release 2.4 Java-oracle regressions retained across qnia integration.
    #[test]
    fn exact_i_ccw_kicks_match_orientation_labels() {
        assert_eq!(
            raw_kicks(Piece::I, 1, -1, Physics::Jstris),
            &[(-1, 0), (1, 0), (-2, 0), (1, 1), (-2, -2)],
        );
        assert_eq!(
            raw_kicks(Piece::I, 3, -1, Physics::Jstris),
            &[(1, 0), (-1, 0), (2, 0), (-1, -1), (2, 2)],
        );
        assert_eq!(
            raw_kicks(Piece::I, 1, -1, Physics::Tetrio),
            &[(-1, 0), (-2, 0), (1, 0), (-2, -2), (1, 1)],
        );
        assert_eq!(
            raw_kicks(Piece::I, 3, -1, Physics::Tetrio),
            &[(1, 0), (2, 0), (-1, 0), (2, 2), (-1, -1)],
        );
    }

    #[test]
    fn cover_exact_reachability_matches_jstris_i_ccw_tuck() {
        // SFinder 1.42 with jstris180.properties accepts this exact bottom I
        // tuck after L/J/S.  The route uses W->S CCW, S->N 180, then shift.
        assert!(reachable_exact_locked(
            0x200e1fc1u64,
            Piece::I,
            0x1eu64,
            4,
            Physics::Jstris,
        ));
    }
}
